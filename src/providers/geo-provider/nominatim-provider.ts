import axios, { AxiosError, AxiosInstance } from 'axios'
import https from 'https'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'

export interface NominatimConfig {
  apiUrl: string
}

type NominatimSearchParams = Record<string, string | number | undefined>

export class NominatimGeoProvider implements GeocodingProvider {
  private static api: AxiosInstance
  private readonly redis: Redis

  // Rate Limiting ONLY (No Cache)
  private readonly RATE_LIMIT_KEY = 'ratelimit:nominatim'
  private readonly RATE_LIMIT_LOCK_TTL_MS = 1000
  private readonly MAX_WAIT_FOR_LOCK_MS = 3000

  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly NOMINATIM_TIMEOUT = 4000
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    redisConnection: Redis,
    private readonly config: NominatimConfig,
  ) {
    this.redis = redisConnection

    if (!NominatimGeoProvider.api) {
      const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 1,
        maxFreeSockets: 1,
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
      addressdetails: 1,
    })

    // 1. Rate Limiting
    await this.waitForRateLimit()

    // 2. Request with Retries
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const result = await NominatimGeoProvider.api.get<any[]>('/search', {
          params: finalParams,
        })

        const first = result.data?.[0]
        if (!first) return null

        const lat = Number.parseFloat(first.lat)
        const lon = Number.parseFloat(first.lon)

        if (Number.isNaN(lat) || Number.isNaN(lon)) return null

        return {
          lat,
          lon,
          precision: this.determinePrecision(first),
        }
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status

        if (status === 429) throw new GeoServiceBusyError('Nominatim')

        const isRetryable = !err.response || (typeof status === 'number' && status >= 500)

        if (!isRetryable || attempt === this.MAX_RETRIES) return null

        const delay = this.BACKOFF_MS * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }
    return null
  }

  private async waitForRateLimit(): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < this.MAX_WAIT_FOR_LOCK_MS) {
      try {
        const acquired = await this.redis.set(this.RATE_LIMIT_KEY, '1', 'PX', this.RATE_LIMIT_LOCK_TTL_MS, 'NX')
        if (acquired === 'OK') return
        await this.sleep(200 + Math.random() * 50)
      } catch (err) {
        await this.sleep(1000)
        return
      }
    }
    throw new GeoServiceBusyError('Nominatim')
  }

  private determinePrecision(item: any): GeoPrecision {
    const type = item.addresstype || item.type || ''
    if (['house', 'building', 'apartments'].includes(type)) return 'ROOFTOP'
    if (['residential', 'secondary', 'tertiary', 'primary', 'road', 'way', 'highway'].includes(type)) return 'ROOFTOP'
    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'village'].includes(type)) return 'NEIGHBORHOOD'
    if (['city', 'town', 'municipality', 'administrative'].includes(type)) return 'CITY'
    if (item.place_rank && item.place_rank < 16) return 'CITY'
    return 'NEIGHBORHOOD'
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
}
