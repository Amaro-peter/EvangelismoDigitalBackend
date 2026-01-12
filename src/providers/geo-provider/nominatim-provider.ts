import axios, { AxiosError, AxiosInstance } from 'axios'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import https from 'https'
import { logger } from '@lib/logger'

type NominatimSearchParams = Record<string, string | number | undefined>

type NominatimSearchItem = {
  lat: string
  lon: string
}

type NominatimSearchResponse = NominatimSearchItem[]

export class NominatimGeoProvider implements GeocodingProvider {
  private static api: AxiosInstance
  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly NOMINATIM_TIMEOUT = 4000
  private readonly KEEP_ALIVE = true
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 1
  private readonly MAX_FREE_SOCKETS = 1
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor() {
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

    // Retry-After can be seconds or an HTTP date
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
    // Base exponential backoff
    const base = this.BACKOFF_MS * Math.pow(2, attempt)

    // If throttled, prefer server guidance
    if (err?.response?.status === 429) {
      const retryAfter = this.parseRetryAfterMs(err.response.headers?.['retry-after'])
      if (retryAfter !== null) {
        return retryAfter
      }
    }

    // Deterministic exponential backoff (no jitter since no workers)
    return base
  }

  private async performRequest(params: NominatimSearchParams): Promise<GeoCoordinates | null> {
    const finalParams = this.cleanParams({
      ...params,
      format: 'jsonv2',
      limit: 1,
    })

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

        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          logger.warn('Coordenadas inválidas recebidas do Nominatim')
          return null
        }

        logger.info({ lat, lon }, 'Geocodificação bem-sucedida')
        return { lat, lon }
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
}
