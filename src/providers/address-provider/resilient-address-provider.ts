import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
import { NoAddressProviderError } from './error/no-address-provider-error'

enum AddressCacheScope {
  CEP = 'cep',
}

export class ResilientAddressProvider implements AddressProvider {
  private readonly cacheManager: ResilientCache

  constructor(
    private readonly providers: AddressProvider[],
    redis: Redis,
    optionsOverride: ResilientCacheOptions,
  ) {
    if (this.providers.length === 0) {
      throw new NoAddressProviderError()
    }

    this.cacheManager = new ResilientCache(redis, {
      prefix: optionsOverride.prefix,
      defaultTtlSeconds: optionsOverride.defaultTtlSeconds,
      negativeTtlSeconds: optionsOverride.negativeTtlSeconds,
      maxPendingFetches: optionsOverride.maxPendingFetches,
      fetchTimeoutMs: optionsOverride.fetchTimeoutMs,
    })
  }

  async fetchAddress(cep: string): Promise<AddressData> {
    const cleanCep = cep.replace(/\D/g, '')

    const cacheKey = this.cacheManager.generateKey({
      _scope: AddressCacheScope.CEP,
      cep: cleanCep,
    })

    // [CRITICAL] Receive the signal from the cache manager callback
    const result = await this.cacheManager.getOrFetch<AddressData>(cacheKey, async (signal) => {
      // Pass the signal down to the strategy
      return this.executeStrategy(cleanCep, signal)
    })

    // If result is null, it means "Invalid CEP" was cached negatively
    if (!result) {
      throw new InvalidCepError()
    }

    return result
  }

  private async executeStrategy(cep: string, signal: AbortSignal): Promise<AddressData | null> {
    let lastError: Error | null = null
    let hasSystemError = false

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      try {
        // [CRITICAL] Pass the signal to the specific provider
        const result = await provider.fetchAddress(cep, signal)

        if (result) {
          logger.info({ provider: providerName }, 'Endereço obtido com sucesso por um provedor de endereço')
          return result
        }
      } catch (error) {
        // 1. Logic Error: Provider explicitly confirmed CEP doesn't exist
        if (error instanceof InvalidCepError) {
          continue
        }

        // 2. System Error: Network, Timeout, Rate Limit, 500s
        hasSystemError = true
        lastError = error as Error
        logger.warn(
          { provider: providerName, error: lastError.message },
          'Provedor falhou (Erro de Sistema). Alternando para fallback...',
        )
      }
    }

    // === DECISION PHASE ===

    if (hasSystemError) {
      logger.error({ cep, lastError }, 'Provedores de endereço falharam com erros de sistema (abortando cache)')
      throw lastError || new Error('Todos os provedores de endereço falharam')
    }

    logger.warn({ cep }, 'CEP confirmado como inválido pelos provedores')
    return null
  }
}
