import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { ResilientCache, ResilientCacheOptions, CachedFailureError } from '@lib/redis/helper/resilient-cache'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'

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

  async fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData | null> {
    const cleanCep = cep.replace(/\D/g, '')

    const cacheKey = this.cacheManager.generateKey({
      _scope: AddressCacheScope.CEP,
      cep: cleanCep,
    })

    try {
      return await this.cacheManager.getOrFetch<AddressData>(
        cacheKey,
        async (effectiveSignal) => {
          return await this.executeStrategy(cleanCep, effectiveSignal)
        },
        // errorMapper: Cache business errors (invalid CEP)
        (error) => {
          if (error instanceof InvalidCepError) {
            return {
              type: 'InvalidCepError',
              message: error.message,
              data: { cep: cleanCep },
            }
          }
          // System errors (network, timeouts, rate limits) - don't cache
          return null
        },
        signal,
      )
    } catch (error) {
      // Convert CachedFailureError back to domain error
      if (error instanceof CachedFailureError) {
        if (error.errorType === 'InvalidCepError') {
          throw new InvalidCepError()
        }
        // Unexpected cached error type
        logger.error({ cep: cleanCep, cachedError: error }, 'Unexpected cached error type in address fetch')
        throw new AddressProviderFailureError()
      }

      // Re-throw domain and system errors as-is
      throw error
    }
  }

  private async executeStrategy(cep: string, signal: AbortSignal): Promise<AddressData> {
    let lastError: Error | unknown = undefined
    let hasSystemError = false
    let lastProviderName = ''
    let notFoundCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive check: Stop immediately if timeout/abort fired
      if (signal.aborted) {
        throw new TimeoutExceededOnFetchError(signal.reason)
      }

      try {
        const result = await provider.fetchAddress(cep, signal)

        if (result) {
          logger.info({ provider: providerName }, 'Endereço obtido com sucesso por um provedor de endereço')
          return result
        }

        // Provider returned null (not found) - count and try next provider
        notFoundCount++
        logger.info({ provider: providerName }, 'Provedor retornou null (não encontrado) - tentando próximo')
      } catch (error) {
        if (error instanceof TimeoutExceededOnFetchError) {
          throw error
        }

        // Business Error: Provider explicitly confirmed CEP doesn't exist
        if (error instanceof InvalidCepError) {
          notFoundCount++
          logger.info({ provider: providerName, cep }, 'CEP inválido reportado por provedor - tentando próximo')
          continue
        }

        // Check if error is 404 - treat as "not found" and try next provider
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          notFoundCount++
          logger.info({ provider: providerName }, 'Provedor retornou 404 (Não Encontrado) - tentando próximo')
          continue
        }

        // SYSTEM ERROR: Record that a system error occurred
        hasSystemError = true
        lastError = error
        lastProviderName = providerName
        const errMsg = error instanceof Error ? error.message : String(error)

        if (error instanceof AddressServiceBusyError) {
          logger.warn(
            { provider: providerName, error: errMsg, attempt: index + 1 },
            'Provedor falhou (Erro de Sistema). Alternando para fallback...',
          )
        } else {
          logger.warn({ provider: providerName, error: errMsg }, 'Provedor falhou (Erro de Sistema). Alternando...')
        }
      }
    }

    // === DECISION PHASE ===
    // Priority 1: If we had system errors, throw the last error (won't be cached)
    // This ensures we retry when providers are unstable, even if some said "not found"
    if (hasSystemError) {
      logger.error(
        { cep, lastError, provider: lastProviderName, notFoundCount },
        'Provedores de endereço falharam com erros de sistema (não cacheando)',
      )
      throw new AddressProviderFailureError(lastError)
    }

    // Priority 2: ALL providers returned null/404/InvalidCepError (no system errors)
    // Only throw InvalidCepError if ALL providers confirmed it doesn't exist
    if (notFoundCount === this.providers.length) {
      logger.info(
        { cep, notFoundCount, totalProviders: this.providers.length },
        'TODOS os provedores confirmaram CEP inválido - cacheando como não encontrado',
      )
      throw new InvalidCepError()
    }

    // This should be unreachable, but as safety net
    logger.error(
      { cep, notFoundCount, totalProviders: this.providers.length },
      'Unexpected code path: partial not-found without system errors',
    )
    throw new AddressProviderFailureError()
  }
}
