import { AxiosError, AxiosInstance } from 'axios'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { createHttpClient } from '@lib/http/axios'
import { logger } from '@lib/logger'
import { EnumProviderConfig, RedisRateLimiter } from '@lib/redis/helper/rate-limiter'
import { PrecisionHelper } from 'providers/helpers/precision-helper'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'

export interface NominatimConfig {
  apiUrl: string
}

type NominatimSearchParams = Record<string, string | number | undefined>

export class NominatimGeoProvider implements GeocodingProvider {
  private static api: AxiosInstance

  // Nominatim API Timeout
  private readonly NOMINATIM_TIMEOUT = 4000

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 100
  private readonly MAX_FREE_SOCKETS = 10
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    private readonly config: NominatimConfig,
    private readonly redisRateLimiterConnection: Redis,
  ) {
    if (!NominatimGeoProvider.api) {
      NominatimGeoProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.NOMINATIM_TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
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
      if (signal?.aborted) {
        throw signal.reason
      }

      const rateLimiter = RedisRateLimiter.getInstance(this.redisRateLimiterConnection)

      const allowed = await rateLimiter.tryConsume(EnumProviderConfig.NOMINATIM_GEOCODING)

      if (!allowed) {
        throw new GeoServiceBusyError('Nominatim (Rate Limit Excedido)')
      }

      const cleanParams = this.cleanParams(params)

      const response = await NominatimGeoProvider.api.get('/search', {
        params: cleanParams,
        signal,
      })

      if (!response.data || response.data.length === 0) {
        return null
      }

      const bestMatch = response.data[0]
      return {
        lat: parseFloat(bestMatch.lat),
        lon: parseFloat(bestMatch.lon),
        precision: PrecisionHelper.fromOsm(bestMatch),
        providerName: 'Nominatim',
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new TimeoutExceededOnFetchError(signal.reason)
      }

      if (error instanceof GeoServiceBusyError) {
        throw error
      }

      const err = error as AxiosError
      const status = err.response?.status

      // 404 means not found - return null to try next provider
      if (status === 404) {
        return null
      }

      // API rate limit (429) - throw so ResilientGeoProvider tries next provider
      if (status === 429) {
        throw new GeoServiceBusyError('Nominatim (Rate Limit Excedido)')
      }

      // Other errors (network, 500, etc.) - throw as system errors
      logger.warn(
        {
          code: err.code,
          name: err.name,
          url: err.config?.url,
          method: err.config?.method,
        },
        'Provedor Nominatim falhou ao buscar coordenadas',
      )
      throw new GeoProviderFailureError()
    }
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
}
