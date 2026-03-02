import Redis from 'ioredis'
import { RateLimiterRedis } from 'rate-limiter-flexible'
import { NoRateLimiterSetError } from '../errors/noRateLimiterSetError'
import { logger } from '@lib/logger'
import { REDIS_KEYS } from 'core/constants/redis/redis-keys'

/**
 * DESIGN DECISION — Rate Limiting Strategy
 *
 * Este rate-limiter foi projetado para proteger APIs externas (3rd-party),
 * onde exceder o limite pode gerar bloqueios, custos financeiros ou
 * interrupção do serviço.
 *
 * ❌ Por que NÃO usamos fallback em memória (RateLimiterMemory / insuranceLimiter):
 * - Fallback em memória cria um comportamento "fail-open" em ambientes distribuídos.
 * - Em caso de indisponibilidade do Redis, cada instância/pod aplicaria o limite
 *   localmente, permitindo bursts globais e potencialmente excedendo o limite real
 *   da API externa.
 * - É possível dividir o limite total de cada provider pela quantidade de instâncias,
 *   mas isso adiciona complexidade e ainda não elimina o risco de estouro.
 * - Para APIs externas, é preferível falhar fechado (fail-closed), protegendo o
 *   provider mesmo que isso implique negar temporariamente requisições internas.
 *
 * ✔️ Estratégia adotada:
 * - Redis é a única fonte de verdade para o rate-limit.
 * - Em falhas de Redis, as requisições são bloqueadas explicitamente.
 * - Essa decisão prioriza a proteção da API externa e a previsibilidade do sistema.
 *
 * 🔧 Por que rate-limiter-flexible:
 * - Implementação madura e amplamente testada em produção.
 * - Suporte nativo a Redis com operações atômicas (Lua scripts).
 * - Seguro para ambientes distribuídos (sem race conditions).
 * - API simples e explícita (consume / remainingPoints).
 * - Evita implementações manuais propensas a bugs, memory leaks e estados inválidos.
 *
 * Observação importante:
 * - Este rate-limiter é GLOBAL por provider (consumerKey = 'global').
 * - O parâmetro "provider" DEVE ser uma string estática.
 * - Nunca use identificadores dinâmicos (ex: userId) como provider,
 *   pois isso causaria crescimento não controlado de memória.
 */

/**
 * Configuração fixa de Rate Limit por Provider.
 * Essas configs DEVEM ser estáticas.
 */
type ProviderRateLimitConfig = {
  points: number
  windowSeconds: number
}

export enum EnumProviderConfig {
  AWESOME_API_ADDRESS = 'awesomeApiAddressProvider',
  VIACEP_ADDRESS = 'viacepAddressProvider',
  LOCATION_IQ_ADDRESS = 'locationIqAddressProvider',
  BRASIL_API_ADDRESS = 'brasilApiAddressProvider',
  NOMINATIM_GEOCODING = 'nominatimGeocodingProvider',
  LOCATION_IQ_GEOCODING = 'locationIqGeocodingProvider',
}

export class RedisRateLimiter {
  private static instance: RedisRateLimiter | null
  private readonly redis: Redis

  // 1 limiter por provider
  private readonly limiters = new Map<EnumProviderConfig, RateLimiterRedis>()

  /**
   * Central de configuração dos providers
   */
  private readonly providerConfigs: Record<EnumProviderConfig, ProviderRateLimitConfig> = {
    [EnumProviderConfig.AWESOME_API_ADDRESS]: {
      points: 5,
      windowSeconds: 1,
    },
    [EnumProviderConfig.VIACEP_ADDRESS]: {
      points: 1,
      windowSeconds: 1,
    },
    [EnumProviderConfig.BRASIL_API_ADDRESS]: {
      points: 5,
      windowSeconds: 1,
    },
    [EnumProviderConfig.LOCATION_IQ_ADDRESS]: {
      points: 2,
      windowSeconds: 1,
    },
    [EnumProviderConfig.NOMINATIM_GEOCODING]: {
      points: 1,
      windowSeconds: 1,
    },
    [EnumProviderConfig.LOCATION_IQ_GEOCODING]: {
      points: 2,
      windowSeconds: 1,
    },
  }

  private constructor(redis: Redis) {
    this.redis = redis
  }

  static getInstance(redis: Redis): RedisRateLimiter {
    if (!this.instance) {
      this.instance = new RedisRateLimiter(redis)
    }

    return this.instance
  }

  /**
   * Retorna ou cria um RateLimiter para o provider.
   * ❗ Provider PRECISA existir em providerConfigs.
   */
  private getLimiter(provider: EnumProviderConfig): RateLimiterRedis {
    const config = this.providerConfigs[provider]

    if (!config) {
      throw new NoRateLimiterSetError(provider)
    }

    const existingLimiter = this.limiters.get(provider)
    if (existingLimiter) {
      return existingLimiter
    }

    const limiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: `${REDIS_KEYS.RATE_LIMIT_PREFIX}${provider}`,
      points: config.points,
      duration: config.windowSeconds,
      execEvenly: false,
      blockDuration: 0,
    })

    this.limiters.set(provider, limiter)

    // Observabilidade defensiva
    if (this.limiters.size > 50) {
      logger.warn(
        { size: this.limiters.size },
        'ALERTA: Muitos RateLimiters instanciados. Verifique se providers estão estáticos.',
      )
    }

    return limiter
  }

  /**
   * Consome 1 ponto do Rate Limit do provider.
   * Bucket GLOBAL compartilhado por todas as instâncias.
   */
  async tryConsume(provider: EnumProviderConfig): Promise<boolean> {
    const CONSUMER_KEY = 'global' // Rate Limit GLOBAL por provider

    try {
      const limiter = this.getLimiter(provider)

      await limiter.consume(CONSUMER_KEY, 1)
      return true
    } catch (error) {
      const err = error as unknown

      if (
        typeof err === 'object' &&
        err !== null &&
        'remainingPoints' in err &&
        typeof (err as Record<string, unknown>).remainingPoints === 'number'
      ) {
        return false
      }

      const obj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {}

      logger.error(
        {
          message: typeof obj.message === 'string' ? obj.message : undefined,
          stack: typeof obj.stack === 'string' ? obj.stack : undefined,
          code: typeof obj.code === 'string' ? obj.code : undefined,
          name: typeof obj.name === 'string' ? obj.name : undefined,
          provider,
        },
        'ERRO CRÍTICO RedisRateLimiter: Redis indisponível. Fail-Closed ativado.',
      )

      return false
    }
  }

  static async destroyInstance() {
    if (!this.instance) {
      logger.debug('Nenhuma instância de RedisRateLimiter para destruir.')
      return
    }

    await this.instance.destroyRateLimiterMap()

    this.instance = null
  }

  private async destroyRateLimiterMap() {
    for (const [provider] of this.limiters.entries()) {
      logger.debug({ provider }, 'Limpando RateLimiter do provider.')
    }

    this.limiters.clear()
  }
}
