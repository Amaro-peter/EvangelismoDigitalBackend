import { AxiosInstance, AxiosError } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'

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

  // Rate Limiting ONLY (No Cache)
  private readonly RATE_LIMIT_KEY = 'ratelimit:locationiq'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 500
  private readonly MAX_WAIT_FOR_LOCK_MS = 2000

  private readonly TIMEOUT = 5000
  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 200

  // Singleton Axios instance with optimized HTTPS Agent
  private readonly KEEP_ALIVE_MSECS = 2000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly TIMEOUT_AGENT = 90000

  constructor(
    redisConnection: Redis,
    private readonly config: LocationIqConfig,
  ) {
    this.redis = redisConnection

    // Singleton initialization using the shared factory
    if (!LocationIqProvider.api) {
      LocationIqProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.TIMEOUT,
        agentOptions: {
          keepAliveMsecs: this.KEEP_ALIVE_MSECS,
          maxSockets: this.MAX_SOCKETS,
          maxFreeSockets: this.MAX_FREE_SOCKETS,
          timeout: this.TIMEOUT_AGENT,
        },
      })
    }
  }

  async search(query: string): Promise<GeoCoordinates | null> {
    return this.performRequest({
      q: query,
      format: 'json',
      limit: 1,
      key: this.config.apiToken,
    })
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    return this.performRequest({
      street: options.street,
      city: options.city,
      state: options.state,
      country: options.country,
      format: 'json',
      limit: 1,
      key: this.config.apiToken,
    })
  }

  private async performRequest(params: Record<string, string | number | undefined>): Promise<GeoCoordinates | null> {
    // 1. Rate Limiting
    await this.waitForRateLimit()

    // 2. HTTP Request with Retries
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await LocationIqProvider.api.get<LocationIqResponseItem[]>('/search', { params })

        const first = response.data?.[0]
        if (!first) return null

        const lat = parseFloat(first.lat)
        const lon = parseFloat(first.lon)
        if (isNaN(lat) || isNaN(lon)) return null

        return {
          lat,
          lon,
          precision: this.determinePrecision(first),
        }
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status

        if (status === 429) {
          throw new GeoServiceBusyError('LocationIQ')
        }

        const isRetryable = !err.response || (status && status >= 500)
        if (!isRetryable || attempt === this.MAX_RETRIES) {
          throw error
        }

        const delay = this.BACKOFF_MS * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }
    return null
  }

  private async waitForRateLimit(): Promise<void> {
    const start = Date.now()
    const pollInterval = 100

    while (Date.now() - start < this.MAX_WAIT_FOR_LOCK_MS) {
      const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')
      if (acquired === 'OK') return
      await this.sleep(pollInterval + Math.random() * 50)
    }

    throw new GeoServiceBusyError('LocationIQ')
  }

  private determinePrecision(item: LocationIqResponseItem): GeoPrecision {
    const type = item.type || item.class || ''
    if (['house', 'building', 'apartments'].includes(type)) return GeoPrecision.ROOFTOP
    if (['residential', 'secondary', 'primary', 'road', 'highway'].includes(type)) return GeoPrecision.ROOFTOP
    if (['city', 'town', 'municipality'].includes(type)) return GeoPrecision.CITY
    return GeoPrecision.NEIGHBORHOOD
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
