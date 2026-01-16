import { AxiosInstance, AxiosError } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'
import { logger } from '@lib/logger'

export interface LocationIqConfig {
  apiUrl: string
  apiToken: string
}

type LocationIqResponseItem = {
  lat: string
  lon: string
  class: string
  type: string
  place_rank?: number
}

export class LocationIqProvider implements GeocodingProvider {
  private static api: AxiosInstance
  private readonly redis: Redis

  private readonly RATE_LIMIT_KEY = 'ratelimit:locationiq'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 1100
  private readonly MAX_WAIT_FOR_LOCK_MS = 5000

  private readonly TIMEOUT = 2000
  private readonly MAX_ATTEMPTS = 1
  private readonly BACKOFF_MS = 200

  constructor(
    redisConnection: Redis,
    private readonly config: LocationIqConfig,
  ) {
    this.redis = redisConnection

    if (!LocationIqProvider.api) {
      LocationIqProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.TIMEOUT,
        params: {
          key: this.config.apiToken,
          format: 'json',
        },
      })
    }
  }

  async search(query: string, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    return this.performRequest({ q: query, limit: 1, addressdetails: 1 }, signal)
  }

  async searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    return this.performRequest(
      {
        street: options.street,
        city: options.city,
        state: options.state,
        country: options.country,
        limit: 1,
        addressdetails: 1,
      },
      signal,
    )
  }

  private async performRequest(params: Record<string, any>, signal?: AbortSignal): Promise<GeoCoordinates | null> {
    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      try {
        await this.waitForRateLimit(signal)

        // [CRITICAL] Connect signal to socket
        const response = await LocationIqProvider.api.get<LocationIqResponseItem[]>('/search', {
          params,
          signal,
        })

        if (!response.data || response.data.length === 0) {
          return null
        }

        const bestMatch = response.data[0]
        return {
          lat: parseFloat(bestMatch.lat),
          lon: parseFloat(bestMatch.lon),
          precision: this.determinePrecision(bestMatch),
        }
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status

        if (status === 404 || status === 400) {
          return null
        }

        if (status === 429) {
          throw new GeoServiceBusyError('LocationIQ')
        }

        const isRetryable = !err.response || (status && status >= 500)

        if (!isRetryable || attempt === this.MAX_ATTEMPTS) {
          logger.warn({ error: err.message, status, attempt }, 'LocationIQ Provider Failed')
          throw err
        }

        const delay = this.BACKOFF_MS * Math.pow(2, attempt - 1)
        await this.sleep(delay)
      }
    }

    return null
  }

  private async waitForRateLimit(signal?: AbortSignal): Promise<void> {
    const start = Date.now()

    while (Date.now() - start < this.MAX_WAIT_FOR_LOCK_MS) {
      if (signal?.aborted) throw new Error('Operation aborted')

      const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')

      if (acquired === 'OK') return

      await this.sleep(100 + Math.random() * 100)
    }

    throw new GeoServiceBusyError('LocationIQ (Local Rate Limit)')
  }

  private determinePrecision(item: LocationIqResponseItem): GeoPrecision {
    const type = item.type || item.class || ''

    if (['house', 'building', 'apartments', 'residential'].includes(type)) {
      return GeoPrecision.ROOFTOP
    }

    if (item.place_rank && item.place_rank >= 26) {
      return GeoPrecision.ROOFTOP
    }

    return GeoPrecision.CITY
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
