import { Redis } from 'ioredis'
import { GeoCacheScope, GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'

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
      ttlJitterPercentage: optionsOverride.ttlJitterPercentage,
    })
  }

  async search(query: string, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({ _method: GeoCacheScope.SEARCH, q: query })

    // [CRITICAL] 1. Use getOrFetch with proper typing allowing 'null'
    return this.cacheManager.getOrFetch<GeoCoordinates | null>(
      cacheKey,
      async (effectiveSignal) => {
        // [CRITICAL] 2. Execute strategy with the COORDINATED signal (Timeout + Global)
        return this.executeStrategy((provider, innerSignal) => provider.search(query, innerSignal), effectiveSignal)
      },
      signal, // 3. Pass parent signal (25s Global Timeout)
    )
  }

  async searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({
      _method: GeoCacheScope.SEARCH_STRUCTURED,
      ...options,
    })

    return this.cacheManager.getOrFetch<GeoCoordinates | null>(
      cacheKey,
      async (effectiveSignal) => {
        return this.executeStrategy(
          (provider, innerSignal) => provider.searchStructured(options, innerSignal),
          effectiveSignal,
        )
      },
      signal,
    )
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider, signal: AbortSignal) => Promise<GeoCoordinates | null>,
    signal: AbortSignal,
  ): Promise<GeoCoordinates | null> {
    let lastError: unknown = null
    let hasSystemError = false

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive Check: Stop immediately if timeout/abort fired
      if (signal.aborted) {
        throw signal.reason
      }

      try {
        // [CRITICAL] 3. Pass signal to the action (which calls the provider)
        const result = await action(provider, signal)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocodificação obtida com sucesso por um provedor de geocodificação')
          return result
        }

        logger.warn({ provider: providerName }, 'Provedor retornou sem resultados (Não Encontrado)')
      } catch (error) {
        // Check for Abort immediately in catch
        if (signal.aborted) {
          throw signal.reason
        }

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
      // Throw error so ResilientCache DOES NOT cache the failure.
      // This allows the next request to try again.
      logger.error({ lastError }, 'Geocodificação falhou com erros de sistema (abortando cache)')
      throw lastError || new GeoProviderFailureError()
    }

    // If no system errors occurred but we found nothing (e.g., all returned null),
    // return null so ResilientCache stores it (Negative Caching).
    return null
  }
}
