import { AxiosInstance, AxiosError } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions, GeoPrecision } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'
import { logger } from '@lib/logger'
import { RedisRateLimiter } from '@lib/redis/helper/rate-limiter'
import { LocationIqProviderError } from './error/location-iq-error'

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

  // Configuração Fail-Fast: 2 requisições por segundo
  private readonly RATE_LIMIT_MAX = 2
  private readonly RATE_LIMIT_WINDOW = 1

  // Timeout da API LocationIQ
  private readonly TIMEOUT = 2000
  private readonly MAX_ATTEMPTS = 2
  private readonly BACKOFF_MS = 200

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 100
  private readonly MAX_FREE_SOCKETS = 10
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    private readonly config: LocationIqConfig,
    private readonly rateLimiter: RedisRateLimiter,
  ) {
    if (!LocationIqProvider.api) {
      LocationIqProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.TIMEOUT,
        params: {
          key: this.config.apiToken,
          format: 'json',
        },
        agentOptions: {
          keepAliveMsecs: this.KEEP_ALIVE_MSECS,
          maxSockets: this.MAX_SOCKETS,
          maxFreeSockets: this.MAX_FREE_SOCKETS,
          timeout: this.HTTPS_AGENT_TIMEOUT,
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
    let lastError: Error | unknown = undefined

    for (let attempt = 1; attempt <= this.MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        throw signal.reason
      }

      // Fail-Fast Rate Limit Check
      // Verifica se temos cota para ESTA tentativa
      const allowed = await this.rateLimiter.tryConsume(
        'locationiq-global',
        this.RATE_LIMIT_MAX,
        this.RATE_LIMIT_WINDOW,
      )

      if (!allowed) {
        // [CRÍTICO] Não espera! Falha imediatamente para que o ResilientGeoProvider
        // possa tentar o próximo provedor (ex: Nominatim ou Google) no mesmo segundo.
        throw new GeoServiceBusyError('LocationIQ (Rate Limit Exceeded)')
      }

      try {
        const response = await LocationIqProvider.api.get<LocationIqResponseItem[]>('/search', {
          params,
          signal,
        })

        if (!response.data || response.data.length === 0) {
          // Not found - return null so ResilientGeoProvider can try next provider
          return null
        }

        const bestMatch = response.data[0]
        return {
          lat: parseFloat(bestMatch.lat),
          lon: parseFloat(bestMatch.lon),
          precision: this.determinePrecision(bestMatch),
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason

        // Se o erro foi o nosso BusyError (lançado acima), repassa imediatamente
        if (error instanceof GeoServiceBusyError) {
          throw error
        }

        const err = error as AxiosError
        const status = err.response?.status

        // Erros de cliente (404) - return null para tentar próximo provider
        if (status === 404) {
          return null
        }

        // Store last error for potential re-throw
        lastError = error

        const isRetryable = !err.response || (status && status >= 500) || status === 429

        if (!isRetryable || attempt === this.MAX_ATTEMPTS) {
          logger.warn({ error: err.message, status, attempt }, 'LocationIQ Provider Failed')
          throw err
        }

        // Backoff apenas para erros de rede/servidor instável
        const delay = this.BACKOFF_MS * Math.pow(2, attempt - 1)
        await this.sleep(delay)
      }
    }

    // This should be unreachable, but as a safety net, throw last error or generic error
    logger.error({ lastError }, 'LocationIQ: Unexpected code path - all attempts exhausted without throw')
    throw lastError || new LocationIqProviderError()
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
