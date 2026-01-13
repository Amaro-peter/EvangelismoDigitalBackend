import axios, { AxiosError, AxiosInstance } from 'axios'
import crypto from 'crypto'
import https from 'https'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { logger } from '@lib/logger'

export interface NominatimConfig {
  apiUrl: string
}

type NominatimSearchParams = Record<string, string | number | undefined>

type NominatimSearchItem = {
  lat: string
  lon: string
  type: string
  class: string
  addresstype?: string
  place_rank?: number
}

type NominatimSearchResponse = NominatimSearchItem[]

export class NominatimGeoProvider implements GeocodingProvider {
  private static api: AxiosInstance
  private readonly redis: Redis

  // ... [Cache & Rate Limit Settings remain unchanged] ...
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90
  private readonly CACHE_PREFIX = 'cache:nominatim:'
  private readonly RATE_LIMIT_KEY = 'ratelimit:nominatim'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 1000

  // HTTP Settings
  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly NOMINATIM_TIMEOUT = 4000
  private readonly KEEP_ALIVE = true
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 1
  private readonly MAX_FREE_SOCKETS = 1
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    redisConnection: Redis,
    private readonly config: NominatimConfig,
  ) {
    this.redis = redisConnection

    if (!NominatimGeoProvider.api) {
      const httpsAgent = new https.Agent({
        keepAlive: this.KEEP_ALIVE,
        keepAliveMsecs: this.KEEP_ALIVE_MSECS,
        maxSockets: this.MAX_SOCKETS,
        maxFreeSockets: this.MAX_FREE_SOCKETS,
        timeout: this.HTTPS_AGENT_TIMEOUT,
      })

      NominatimGeoProvider.api = axios.create({
        baseURL: this.config.apiUrl,
        timeout: this.NOMINATIM_TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
        },
        httpsAgent,
      })
    }
  }

  // ... [Rest of the methods: search, performRequest, waitForRateLimit, etc. remain unchanged] ...

  async search(query: string): Promise<GeoCoordinates | null> {
    return this.performRequest({ q: query })
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    return this.performRequest({
      street: options.street,
      neighborhood: options.neighborhood,
      city: options.city,
      state: options.state,
      country: options.country,
    })
  }

  private async performRequest(params: NominatimSearchParams): Promise<GeoCoordinates | null> {
    // ... [Implementation unchanged] ...
    // (Included for brevity, assume full implementation matches previous file)
    const finalParams = this.cleanParams({
      ...params,
      format: 'jsonv2',
      limit: 1,
      addressdetails: 1,
    })

    const cacheKey = this.generateCacheKey(finalParams)
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        logger.info('Geocoding result fetched from Redis cache')
        return JSON.parse(cached)
      }
    } catch (err) {
      logger.error({ error: err }, 'Redis error during Nominatim cache read')
    }

    await this.waitForRateLimit()

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await NominatimGeoProvider.api.get<NominatimSearchResponse>('/search', {
          params: finalParams,
        })

        const first = result.data?.[0]
        if (!first) {
          logger.info('Nenhum resultado encontrado na geocodificação')
          return null
        }

        const lat = Number.parseFloat(first.lat)
        const lon = Number.parseFloat(first.lon)
        const precision = this.determinePrecision(first)

        if (Number.isNaN(lat) || Number.isNaN(lon)) return null

        const geoResult: GeoCoordinates = { lat, lon, precision }

        await this.redis.set(cacheKey, JSON.stringify(geoResult), 'EX', this.CACHE_TTL_SECONDS)
        return geoResult
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
          return null
        }
        const delay = this.computeDelayMs(attempt, err)
        await this.sleep(delay)
      }
    }
    return null
  }

  // ... [Helper methods: waitForRateLimit, determinePrecision, generateCacheKey, cleanParams, sleep, etc.] ...
  private async waitForRateLimit(): Promise<void> {
    const POLL_INTERVAL_MS = 200
    const JITTER_MS = 50
    while (true) {
      try {
        const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')
        if (acquired === 'OK') return
        await this.sleep(POLL_INTERVAL_MS + Math.random() * JITTER_MS)
      } catch (err) {
        await this.sleep(1000)
        return
      }
    }
  }

  private determinePrecision(item: NominatimSearchItem): GeoPrecision {
    const type = item.addresstype || item.type || ''
    if (['house', 'building', 'apartments'].includes(type)) return 'ROOFTOP'
    if (['residential', 'secondary', 'tertiary', 'primary', 'road', 'way', 'highway'].includes(type)) return 'ROOFTOP'
    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village'].includes(type)) return 'NEIGHBORHOOD'
    if (['city', 'town', 'municipality', 'administrative'].includes(type)) return 'CITY'
    if (item.place_rank && item.place_rank < 16) return 'CITY'
    return 'NEIGHBORHOOD'
  }

  private generateCacheKey(params: Record<string, unknown>): string {
    const str = JSON.stringify(params)
    const hash = crypto.createHash('sha256').update(str).digest('hex')
    return `${this.CACHE_PREFIX}${hash}`
  }

  private cleanParams(params: NominatimSearchParams): Record<string, string | number> {
    const cleaned: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (typeof value === 'string' && value.trim().length === 0) continue
      cleaned[key] = typeof value === 'string' ? value.trim() : value
    }
    return cleaned
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private parseRetryAfterMs(value: unknown): number | null {
    if (typeof value !== 'string') return null
    const asSeconds = Number.parseInt(value, 10)
    if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds * 1000
    const asDate = Date.parse(value)
    if (!Number.isNaN(asDate)) {
      const delta = asDate - Date.now()
      return delta > 0 ? delta : 0
    }
    return null
  }

  private computeDelayMs(attempt: number, err?: AxiosError): number {
    const base = this.BACKOFF_MS * Math.pow(2, attempt)
    if (err?.response?.status === 429) {
      const retryAfter = this.parseRetryAfterMs(err.response.headers?.['retry-after'])
      if (retryAfter !== null) return retryAfter
    }
    return base
  }
}
