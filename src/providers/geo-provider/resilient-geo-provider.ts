import { Redis } from 'ioredis'
import { GeoCacheScope, GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
import { NoGeoProviderError } from './error/no-geo-provider-error'

export class ResilientGeoProvider implements GeocodingProvider {
  private readonly cacheManager: ResilientCache

  constructor(
    private readonly providers: GeocodingProvider[],
    redis: Redis,
    optionsOverride: ResilientCacheOptions,
  ) {
    if (this.providers.length === 0) {
      throw new NoGeoProviderError()
    }

    this.cacheManager = new ResilientCache(redis, {
      prefix: optionsOverride.prefix,
      defaultTtlSeconds: optionsOverride.defaultTtlSeconds,
      negativeTtlSeconds: optionsOverride.negativeTtlSeconds,
      maxPendingFetches: optionsOverride.maxPendingFetches,
      fetchTimeoutMs: optionsOverride.fetchTimeoutMs,
    })
  }

  async search(query: string, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({ _method: GeoCacheScope.SEARCH, q: query })

    // [CRITICAL] 1. Pass the signal from 'getOrFetch' down to 'executeStrategy'
    return this.cacheManager.getOrFetch(cacheKey, (signal) => {
      return this.executeStrategy((provider, sig) => provider.search(query, sig), signal)
    })
  }

  async searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({
      _method: GeoCacheScope.SEARCH_STRUCTURED,
      ...options,
    })

    // [CRITICAL] 1. Pass the signal from 'getOrFetch' down to 'executeStrategy'
    return this.cacheManager.getOrFetch(cacheKey, (signal) => {
      return this.executeStrategy((provider, sig) => provider.searchStructured(options, sig), signal)
    })
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider, signal: AbortSignal) => Promise<GeoCoordinates | null>,
    signal: AbortSignal, // [CRITICAL] 2. Receive signal here
  ): Promise<GeoCoordinates | null> {
    let lastError: unknown = null
    let hasSystemError = false

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      try {
        // [CRITICAL] 3. Pass signal to the action (which calls the provider)
        const result = await action(provider, signal)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocodificação obtida com sucesso por um provedor de geocodificação')
          return result
        }

        logger.warn({ provider: providerName }, 'Provedor retornou sem resultados (Não Encontrado)')
      } catch (error) {
        // SYSTEM FAIL: Record that a system error occurred
        hasSystemError = true
        lastError = error
        const errMsg = error instanceof Error ? error.message : String(error)

        if (error instanceof GeoServiceBusyError) {
          logger.warn(
            { provider: providerName, attempt: index + 1 },
            'Provedor está ocupado (Limite de Taxa). Alternando...',
          )
        } else {
          logger.warn({ provider: providerName, error: errMsg }, 'Provedor falhou (Erro de Sistema). Alternando...')
        }
      }
    }

    // === DECISION PHASE ===
    if (hasSystemError) {
      logger.error({ lastError }, 'Geocodificação falhou com erros de sistema (abortando cache)')
      throw lastError || new Error('Todos os provedores de geocodificação falharam')
    }

    logger.warn('Geocodificação falhou para todos os provedores')
    return null
  }
}
