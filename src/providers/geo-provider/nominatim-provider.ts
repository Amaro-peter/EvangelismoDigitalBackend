import { AxiosError, AxiosInstance } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'
import { logger } from '@lib/logger'
import { OperationAbortedError } from '@lib/redis/errors/operation-aborted-error'

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

  private readonly NOMINATIM_TIMEOUT = 4000

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

  async search(query: string, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    return this.performRequest({ q: query, limit: 1, format: 'json' }, signal)
  }

  async searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    return this.performRequest(
      {
        street: options.street,
        city: options.city,
        state: options.state,
        country: options.country,
        limit: 1,
        format: 'json',
      },
      signal,
    )
  }

  private async performRequest(params: NominatimSearchParams, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    try {
      // 1. Enforce Rate Limit (Respect TOS)
      await this.waitForRateLimit(signal)

      const cleanParams = this.cleanParams(params)

      // [CRITICAL] Pass signal to Axios
      const response = await NominatimGeoProvider.api.get<any[]>('/search', {
        params: cleanParams,
        signal,
      })

      // 2. Handle Semantic "Not Found"
      if (!response.data || response.data.length === 0) {
        return null
      }

      // 3. Map Success Response
      const bestMatch = response.data[0]
      return {
        lat: parseFloat(bestMatch.lat),
        lon: parseFloat(bestMatch.lon),
        precision: this.determinePrecision(bestMatch),
      }
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason
      }

      const err = error as AxiosError
      const status = err.response?.status

      if (status === 404) {
        return null
      }

      // Case B: Rate Limited (429)
      if (status === 429) {
        logger.warn('Nominatim Rate Limit Hit (429)')
        throw new GeoServiceBusyError('Nominatim')
      }

      // Case C: System/Network Errors
      logger.warn({ error: err.message, status }, 'Nominatim Provider Failed')
      throw error
    }
  }

  private async waitForRateLimit(signal?: AbortSignal): Promise<void> {
    const start = Date.now()
    // Poll for lock availability
    while (Date.now() - start < this.MAX_WAIT_FOR_LOCK_MS) {
      // [CRITICAL] Check signal inside the wait loop
      if (signal?.aborted) {
        throw signal.reason
      }

      try {
        const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')
        if (acquired === 'OK') return

        await this.sleep(200 + Math.random() * 50)
      } catch (err) {
        logger.warn({ err }, 'Redis error during Nominatim rate limiting')
        await this.sleep(1000)
        return
      }
    }
    throw new GeoServiceBusyError('Nominatim (Local Rate Limit Timeout)')
  }

  private determinePrecision(item: any): GeoPrecision {
    const type = item.addresstype || item.type || ''

    if (['house', 'building', 'apartments', 'residential'].includes(type)) return GeoPrecision.ROOFTOP
    if (['secondary', 'tertiary', 'primary', 'road', 'way', 'highway'].includes(type)) return GeoPrecision.ROOFTOP

    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village'].includes(type)) return GeoPrecision.NEIGHBORHOOD

    if (['city', 'town', 'municipality', 'administrative'].includes(type)) return GeoPrecision.CITY

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
