import { AxiosError, AxiosInstance } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'
import { logger } from '@lib/logger'

export interface NominatimConfig {
  apiUrl: string
}

type NominatimSearchParams = Record<string, string | number | undefined>

export class NominatimGeoProvider implements GeocodingProvider {
  private static api: AxiosInstance
  private readonly redis: Redis

  // Rate Limiting ONLY (No Cache - Caching is handled by ResilientGeoProvider)
  private readonly RATE_LIMIT_KEY = 'ratelimit:nominatim'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 1100 // Slightly > 1s (Nominatim policy is strict 1 req/sec)
  private readonly MAX_WAIT_FOR_LOCK_MS = 5000 // Wait up to 5s for a slot

  private readonly BACKOFF_MS = 300
  private readonly NOMINATIM_TIMEOUT = 6000

  constructor(
    redisConnection: Redis,
    private readonly config: NominatimConfig,
  ) {
    this.redis = redisConnection
    if (!NominatimGeoProvider.api) {
      NominatimGeoProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.NOMINATIM_TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0', // Required by Nominatim TOS
        },
      })
    }
  }

  async search(query: string): Promise<GeoCoordinates | null> {
    return this.performRequest({ q: query, limit: 1, format: 'json' })
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    return this.performRequest({
      street: options.street,
      city: options.city,
      state: options.state,
      country: options.country,
      limit: 1,
      format: 'json',
    })
  }

  private async performRequest(params: NominatimSearchParams): Promise<GeoCoordinates | null> {
    try {
      // 1. Enforce Rate Limit (Respect TOS)
      await this.waitForRateLimit()

      const cleanParams = this.cleanParams(params)
      const response = await NominatimGeoProvider.api.get<any[]>('/search', { params: cleanParams })

      // 2. Handle Semantic "Not Found"
      // Nominatim returns an empty array [] when nothing is found.
      if (!response.data || response.data.length === 0) {
        return null // Safe to cache as "Not Found"
      }

      // 3. Map Success Response
      const bestMatch = response.data[0]
      return {
        lat: parseFloat(bestMatch.lat),
        lon: parseFloat(bestMatch.lon),
        precision: this.determinePrecision(bestMatch),
      }
    } catch (error) {
      const err = error as AxiosError
      const status = err.response?.status

      if (status === 404) {
        return null
      }

      // Case B: Rate Limited (429) - Throw specific error to trigger fallback provider
      if (status === 429) {
        logger.warn('Nominatim Rate Limit Hit (429)')
        throw new GeoServiceBusyError('Nominatim')
      }

      // Case C: System/Network Errors (500, Timeout, DNS)
      // DO NOT return null. Throwing ensures we do NOT cache this failure.
      logger.warn({ error: err.message, status }, 'Nominatim Provider Failed')
      throw error
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const start = Date.now()
    // Poll for lock availability
    while (Date.now() - start < this.MAX_WAIT_FOR_LOCK_MS) {
      try {
        const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')
        if (acquired === 'OK') return

        // Wait random small interval before retrying to avoid thundering herd locally
        await this.sleep(200 + Math.random() * 50)
      } catch (err) {
        // If Redis fails, we wait a bit and try to proceed degraded (or throw)
        logger.warn({ err }, 'Redis error during Nominatim rate limiting')
        await this.sleep(1000)
        return // Proceeding risky, or could throw
      }
    }
    throw new GeoServiceBusyError('Nominatim (Local Rate Limit Timeout)')
  }

  private determinePrecision(item: any): GeoPrecision {
    const type = item.addresstype || item.type || ''

    // High Precision
    if (['house', 'building', 'apartments', 'residential'].includes(type)) return GeoPrecision.ROOFTOP
    if (['secondary', 'tertiary', 'primary', 'road', 'way', 'highway'].includes(type)) return GeoPrecision.ROOFTOP

    // Medium Precision
    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village'].includes(type)) return GeoPrecision.NEIGHBORHOOD

    // Low Precision
    if (['city', 'town', 'municipality', 'administrative'].includes(type)) return GeoPrecision.CITY

    // Fallback based on rank if available
    if (item.place_rank) {
      if (item.place_rank >= 26) return GeoPrecision.ROOFTOP
      if (item.place_rank >= 16) return GeoPrecision.NEIGHBORHOOD
      return GeoPrecision.CITY
    }

    return GeoPrecision.CITY
  }

  private cleanParams(params: NominatimSearchParams): Record<string, string | number> {
    const cleaned: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        cleaned[key] = value
      }
    }
    return cleaned
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
