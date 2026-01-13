import axios, { AxiosError, AxiosInstance } from 'axios'
import crypto from 'crypto'
import https from 'https'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { logger } from '@lib/logger'

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

  // Cache Settings
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days
  private readonly CACHE_PREFIX = 'cache:nominatim:'

  // Rate Limit Settings
  private readonly RATE_LIMIT_KEY = 'ratelimit:nominatim'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 1000 // 1 request per second enforced via lock

  // HTTP Settings
  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly NOMINATIM_TIMEOUT = 4000
  private readonly KEEP_ALIVE = true
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 1
  private readonly MAX_FREE_SOCKETS = 1
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(redisConnection: Redis) {
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
        baseURL: process.env.GEOCODING_API_URL,
        timeout: this.NOMINATIM_TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
        },
        httpsAgent,
      })
    }
  }

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
    const finalParams = this.cleanParams({
      ...params,
      format: 'jsonv2',
      limit: 1,
      addressdetails: 1, // Required for precision inference
    })

    // 1. Check Cache
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

    // 2. Distributed Rate Limiting (Blocking)
    await this.waitForRateLimit()

    // 3. Execute Request
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await NominatimGeoProvider.api.get<NominatimSearchResponse>('/search', {
          params: finalParams,
        })

        const first = result.data?.[0]
        if (!first) {
          logger.info('Nenhum resultado encontrado na geocodificação')
          // Optional: Cache null results with shorter TTL to prevent hammering?
          // For now, returning null without caching negative results.
          return null
        }

        const lat = Number.parseFloat(first.lat)
        const lon = Number.parseFloat(first.lon)
        const precision = this.determinePrecision(first)

        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          logger.warn('Coordenadas inválidas recebidas do Nominatim')
          return null
        }

        const geoResult: GeoCoordinates = { lat, lon, precision }
        logger.info({ lat, lon, precision }, 'Geocodificação bem-sucedida')

        // 4. Save to Cache
        try {
          await this.redis.set(cacheKey, JSON.stringify(geoResult), 'EX', this.CACHE_TTL_SECONDS)
        } catch (err) {
          logger.error({ error: err }, 'Redis error during Nominatim cache write')
        }

        return geoResult
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
          logger.error({ attempt, status, error: err.message }, 'Falha na geocodificação após tentativas')
          return null
        }

        const delay = this.computeDelayMs(attempt, err)
        logger.warn({ attempt, delay, status }, 'Repetindo solicitação de geocodificação')
        await this.sleep(delay)
      }
    }

    return null
  }

  /**
   * Distributed Rate Limiter
   * Uses a Redis key with short TTL to enforce global 1 req/sec limit.
   * If the key exists, it waits and retries.
   */
  private async waitForRateLimit(): Promise<void> {
    const POLL_INTERVAL_MS = 200
    const JITTER_MS = 50

    while (true) {
      try {
        // Try to acquire the lock: SET NX (Not Exists) with Expiry
        const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')

        if (acquired === 'OK') {
          return // Lock acquired, proceed
        }

        // Lock exists, wait before retrying
        await this.sleep(POLL_INTERVAL_MS + Math.random() * JITTER_MS)
      } catch (err) {
        logger.error({ error: err }, 'Redis error in rate limiter. Proceeding cautiously.')
        await this.sleep(1000) // Fallback safe delay
        return
      }
    }
  }

  private determinePrecision(item: NominatimSearchItem): GeoPrecision {
    // Priority check based on 'addresstype' or 'type' provided by jsonv2 + addressdetails
    const type = item.addresstype || item.type || ''

    // Exact locations
    if (['house', 'building', 'apartments'].includes(type)) {
      return 'ROOFTOP'
    }

    // Street level / Point on road (High precision enough for "Address Found")
    if (['residential', 'secondary', 'tertiary', 'primary', 'road', 'way', 'highway'].includes(type)) {
      return 'ROOFTOP'
    }

    // Neighborhood level
    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village'].includes(type)) {
      return 'NEIGHBORHOOD'
    }

    // City/Admin level
    if (['city', 'town', 'municipality', 'administrative'].includes(type)) {
      return 'CITY'
    }

    // Default fallback based on rank if available (rank < 16 usually means large area)
    if (item.place_rank && item.place_rank < 16) {
      return 'CITY'
    }

    return 'NEIGHBORHOOD' // Safe default fallback
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
