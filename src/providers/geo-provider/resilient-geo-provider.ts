import { Redis } from 'ioredis'
import { GeoCacheScope, GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { ResilientCache, ResilientCacheOptions, CachedFailureError } from '@lib/redis/helper/resilient-cache'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'

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

    try {
      return await this.cacheManager.getOrFetch<GeoCoordinates>(
        cacheKey,
        async (effectiveSignal) => {
          return await this.executeStrategy(
            (provider, innerSignal) => provider.search(query, innerSignal),
            effectiveSignal,
          )
        },
        // errorMapper: Cache business errors (coordinates not found)
        (error) => {
          if (error instanceof CoordinatesNotFoundError) {
            return {
              type: 'CoordinatesNotFoundError',
              message: error.message,
              data: { query },
            }
          }
          // System errors (rate limits, network issues) - don't cache
          return null
        },
        signal,
      )
    } catch (error) {
      // Convert CachedFailureError back to domain error
      if (error instanceof CachedFailureError) {
        if (error.errorType === 'CoordinatesNotFoundError') {
          throw new CoordinatesNotFoundError()
        }
        // Unexpected cached error type
        logger.error(
          { query, cachedError: error },
          'Tipo de erro em cache inesperado na busca simples por geocodificação',
        )
        throw new GeoProviderFailureError()
      }

      // Re-throw domain and system errors as-is
      throw error
    }
  }

  async searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({
      _method: GeoCacheScope.SEARCH_STRUCTURED,
      ...options,
    })

    try {
      return await this.cacheManager.getOrFetch<GeoCoordinates>(
        cacheKey,
        async (effectiveSignal) => {
          return await this.executeStrategy(
            (provider, innerSignal) => provider.searchStructured(options, innerSignal),
            effectiveSignal,
          )
        },
        // errorMapper: Cache business errors (coordinates not found)
        (error) => {
          if (error instanceof CoordinatesNotFoundError) {
            return {
              type: 'CoordinatesNotFoundError',
              message: error.message,
              data: { options },
            }
          }
          // System errors (rate limits, network issues) - don't cache
          return null
        },
        signal,
      )
    } catch (error) {
      // Convert CachedFailureError back to domain error
      if (error instanceof CachedFailureError) {
        if (error.errorType === 'CoordinatesNotFoundError') {
          throw new CoordinatesNotFoundError()
        }
        // Unexpected cached error type
        logger.error(
          { options, cachedError: error },
          'Tipo de erro em cache inesperado na busca estruturada por geocodificação',
        )
        throw new GeoProviderFailureError()
      }

      // Re-throw domain and system errors as-is
      throw error
    }
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider, signal: AbortSignal) => Promise<GeoCoordinates | null>,
    signal: AbortSignal,
  ): Promise<GeoCoordinates> {
    let lastError: Error | unknown = undefined
    let hasSystemError = false
    let lastProviderName = ''
    let notFoundCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive Check: Stop immediately if timeout/abort fired
      if (signal.aborted) {
        throw new TimeoutExceededOnFetchError(signal.reason)
      }

      try {
        const result = await action(provider, signal)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocodificação obtida com sucesso por um provedor de geocodificação')
          return result
        }

        // Provider returned null (not found) - try next provider
        notFoundCount++
        logger.info({ provider: providerName }, 'Provedor retornou null (não encontrado) - tentando próximo')
      } catch (error) {
        if (error instanceof TimeoutExceededOnFetchError) {
          throw error
        }

        if (error instanceof CoordinatesNotFoundError) {
          notFoundCount++
          logger.info({ provider: providerName }, 'Coordenadas não encontradas - tentando próximo')
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
    // If we had system errors, throw the last error (won't be cached)
    if (hasSystemError) {
      logger.error(
        { lastError, provider: lastProviderName },
        'Geocodificação falhou com erros de sistema (não cacheando)',
      )
      throw new GeoProviderFailureError(lastError)
    }

    // All providers returned null or 404 (no system errors)
    // This is a business error: coordinates legitimately don't exist
    if (notFoundCount === this.providers.length) {
      logger.info('Nenhum provedor retornou resultados - coordenadas não encontradas')
      throw new CoordinatesNotFoundError()
    }

    throw new GeoProviderFailureError()
  }
}
