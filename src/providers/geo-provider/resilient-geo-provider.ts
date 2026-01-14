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

    // Initialize the new cache helper
    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:geocoding:',
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour
    })
  }

  async search(query: string): Promise<GeoCoordinates | null> {
    // Generate key using the helper
    const cacheKey = this.cacheManager.generateKey({ _method: GeoCacheScope.SEARCH, q: query })

    // Execute with cache protection
    return this.cacheManager.getOrFetch(cacheKey, () => {
      return this.executeStrategy((provider) => provider.search(query))
    })
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    const cacheKey = this.cacheManager.generateKey({ _method: GeoCacheScope.SEARCH_STRUCTURED, ...options })

    return this.cacheManager.getOrFetch(cacheKey, () => {
      return this.executeStrategy((provider) => provider.searchStructured(options))
    })
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    let lastError: unknown = null

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name
      const isLastProvider = index === this.providers.length - 1

      try {
        const result = await action(provider)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocoding successful')
          return result
        }

        if (!isLastProvider) {
          logger.warn({ provider: providerName }, 'Provider returned no results, trying fallback...')
        } else {
          logger.warn({ provider: providerName }, 'Last provider returned no results')
        }
      } catch (error) {
        lastError = error

        if (error instanceof GeoServiceBusyError) {
          logger.warn(
            { provider: providerName, attempt: index + 1 },
            'Provider is busy (Rate Limit). Switching to fallback...',
          )
        } else {
          logger.warn(
            { provider: providerName, error: (error as Error).message },
            'Provider failed. Switching to fallback...',
          )
        }

        if (isLastProvider) {
          logger.error({ lastError }, 'All geocoding providers failed with errors')
          throw lastError
        }
      }
    }

    logger.warn('All geocoding providers returned no results')
    return null
  }
}
