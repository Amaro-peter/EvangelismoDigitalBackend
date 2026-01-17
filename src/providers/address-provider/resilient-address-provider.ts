import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'

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
      ttlJitterPercentage: optionsOverride.ttlJitterPercentage,
    })
  }

  // UPDATE: Now accepts 'signal' from the UseCase
  async fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData | null> {
    const cleanCep = cep.replace(/\D/g, '')

    const cacheKey = this.cacheManager.generateKey({
      _scope: AddressCacheScope.CEP,
      cep: cleanCep,
    })

    // 1. Use getOrFetch with proper typing allowing 'null' (Negative Cache)
    return this.cacheManager.getOrFetch<AddressData | null>(
      cacheKey,
      async (effectiveSignal) => {
        // 2. Pass the coordinated signal to the strategy
        return this.executeStrategy(cleanCep, effectiveSignal)
      },
      signal, // 3. Pass the parent signal (Global 25s timeout)
    )
  }

  private async executeStrategy(cep: string, signal: AbortSignal): Promise<AddressData | null> {
    let lastError: Error | null = null
    let hasSystemError = false

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive check: If we are already aborted before starting the next provider, stop.
      if (signal.aborted) {
        throw signal.reason
      }

      try {
        // [CRITICAL] Pass the signal to the specific provider (ViaCep/AwesomeAPI)
        // Note: Ideally, specific providers should also accept 'signal'.
        // If they don't yet, they will run to completion, but we won't wait for them here if signal aborts.
        const result = await provider.fetchAddress(cep, signal)

        if (result) {
          logger.info({ provider: providerName }, 'Endereço obtido com sucesso por um provedor de endereço')
          return result
        }
      } catch (error) {
        // 1. Check for Abort/Timeout first
        if (signal.aborted) {
          throw signal.reason
        }

        // 2. Logic Error: Provider explicitly confirmed CEP doesn't exist
        // (e.g., ViaCEP returned { erro: true })
        if (error instanceof InvalidCepError) {
          // If one provider says it's invalid, we usually trust it and stop trying others
          // to avoid wasting resources, OR we can treat it as a "vote" and try others.
          // In this architecture, usually "Invalid" means truly invalid.
          // We throw it so getOrFetch can catch it and store 'null'.
          throw error
        }

        // 3. System Error: Network, Timeout, Rate Limit, 500s
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
      // If we had system errors and no success, we throw the error.
      // ResilientCache will NOT cache this, allowing a retry.
      logger.error({ cep, lastError }, 'Provedores de endereço falharam com erros de sistema (abortando cache)')
      throw lastError || new AddressProviderFailureError()
    }

    // If we simply found nothing (no errors, just empty results), we return null.
    // ResilientCache will cache this as null (Negative Cache).
    return null
  }
}
