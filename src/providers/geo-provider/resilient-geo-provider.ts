import { Redis } from 'ioredis'
import { GeoCacheScope, GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { ResilientCache } from '@lib/redis/resilient-cache'

export class ResilientGeoProvider implements GeocodingProvider {
  private readonly cacheManager: ResilientCache

  constructor(
    private readonly providers: GeocodingProvider[],
    redis: Redis,
  ) {
    if (this.providers.length === 0) {
      throw new Error('ResilientGeoProvider requires at least one provider')
    }

    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:geocoding:',
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour
    })
  }

  async search(query: string): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({ _method: GeoCacheScope.SEARCH, q: query })

    return this.cacheManager.getOrFetch(cacheKey, () => {
      return this.executeStrategy((provider) => provider.search(query))
    })
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({
      _method: GeoCacheScope.SEARCH_STRUCTURED,
      ...options,
    })

    return this.cacheManager.getOrFetch(cacheKey, () => {
      return this.executeStrategy((provider) => provider.searchStructured(options))
    })
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    let lastError: unknown = null
    let hasSystemError = false // [FIX] Track if any system error occurred

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      try {
        const result = await action(provider)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocoding successful')
          return result
        }

        logger.warn({ provider: providerName }, 'Provider returned no results (Not Found)')
      } catch (error) {
        // SYSTEM FAIL: Record that a system error occurred
        hasSystemError = true
        lastError = error
        const errMsg = error instanceof Error ? error.message : String(error)

        if (error instanceof GeoServiceBusyError) {
          logger.warn({ provider: providerName, attempt: index + 1 }, 'Provider is busy (Rate Limit). Switching...')
        } else {
          logger.warn({ provider: providerName, error: errMsg }, 'Provider failed (System Error). Switching...')
        }
      }
    }

    // === DECISION PHASE ===

    // [FIX] If ANY provider failed with a system error, we cannot trust a "Not Found" result
    // from other providers (which might be weaker fallbacks). We must THROW to abort caching.
    if (hasSystemError) {
      logger.error({ lastError }, 'Geocoding failed with system errors (aborting cache)')
      throw lastError || new Error('All geocoding providers failed')
    }

    // If we are here, it means ALL providers ran successfully and returned NULL.
    // It is safe to negative cache this.
    logger.warn('Geocoding confirmed as "Not Found" by all providers')
    return null
  }
}
