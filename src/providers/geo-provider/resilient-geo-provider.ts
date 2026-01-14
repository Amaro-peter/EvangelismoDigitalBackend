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

    // Initialize the cache helper
    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:geocoding:',
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour (Smart Negative Caching)
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
    let notFoundCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      try {
        const result = await action(provider)

        // SUCCESS: Provider found coordinates
        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocoding successful')
          return result
        }

        // LOGIC FAIL: Provider returned null (Semantic "Not Found")
        // We do NOT return immediately; we try other providers in case one has better data.
        notFoundCount++
        logger.warn({ provider: providerName }, 'Provider returned no results (Not Found)')
      } catch (error) {
        // SYSTEM FAIL: Provider threw error (Network, Rate Limit, etc.)
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

    // Case A: At least one provider said "Not Found" (and no one succeeded).
    // We treat this as a confirmed "Not Found".
    // Return NULL -> ResilientCache saves a Negative Cache Entry (1 hour).
    if (notFoundCount > 0) {
      logger.warn({ notFoundCount }, 'Geocoding confirmed as "Not Found" by providers')
      return null
    }

    // Case B: All providers failed with System Errors (no one said "Not Found").
    // We DO NOT return null (which would poison the cache).
    // Throw LAST ERROR -> ResilientCache aborts saving anything.
    logger.error({ lastError }, 'All geocoding providers failed with system errors')
    throw lastError || new Error('All geocoding providers failed')
  }
}
