import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { AddressData, AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates, GeoPrecision } from 'providers/geo-provider/geo-provider.interface'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'
import { ResilientCache, ResilientCacheOptions, CachedFailureError } from '@lib/redis/helper/resilient-cache'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { CepToLatLonError } from '@use-cases/errors/cep-to-lat-lon-error'
import { ServiceOverloadError } from '@lib/redis/errors/service-overload-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'
import { AddressProviderFailureError } from 'providers/address-provider/error/address-provider-failure-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'

interface CepToLatLonRequest {
  cep: string
}

interface CepToLatLonResponse {
  userLat: number
  userLon: number
  precision: GeoPrecision
}

export class CepToLatLonUseCase {
  private readonly cacheManager: ResilientCache

  constructor(
    private geocodingProvider: GeocodingProvider,
    private addressProvider: AddressProvider,
    redis: Redis,
    optionsOverride: ResilientCacheOptions,
  ) {
    this.cacheManager = new ResilientCache(redis, {
      prefix: optionsOverride.prefix,
      defaultTtlSeconds: optionsOverride.defaultTtlSeconds,
      negativeTtlSeconds: optionsOverride.negativeTtlSeconds,
      maxPendingFetches: optionsOverride.maxPendingFetches,
      fetchTimeoutMs: optionsOverride.fetchTimeoutMs,
      ttlJitterPercentage: optionsOverride.ttlJitterPercentage,
    })
  }

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = this.cacheManager.generateKey({ cep: cleanCep })

    try {
      const result = await this.cacheManager.getOrFetch<CepToLatLonResponse>(
        cacheKey,
        async (signal) => {
          // This will throw InvalidCepError or CoordinatesNotFoundError
          // which will be caught by errorMapper and cached
          return await this.processCep(cleanCep, signal)
        },
        // errorMapper: Define which errors should be cached (business errors)
        (error) => {
          // Business errors - these should be cached with negativeTtl
          if (error instanceof InvalidCepError) {
            return {
              type: 'InvalidCepError',
              message: error.message,
              data: { cep: cleanCep },
            }
          }

          if (error instanceof CoordinatesNotFoundError) {
            return {
              type: 'CoordinatesNotFoundError',
              message: error.message,
              data: { cep: cleanCep },
            }
          }

          // System errors (timeouts, rate limits, 500s) - NOT cached
          // Returning null means "don't cache this error"
          return null
        },
      )

      if (!result) {
        throw new CepToLatLonError()
      }

      return result
    } catch (error) {
      // Handle CachedFailureError - convert back to domain errors
      if (error instanceof CachedFailureError) {
        if (error.errorType === 'InvalidCepError') {
          throw new InvalidCepError()
        }
        if (error.errorType === 'CoordinatesNotFoundError') {
          throw new CoordinatesNotFoundError()
        }
        // This shouldn't happen, but fallback to generic error
        logger.error({ cep: cleanCep, cachedError: error }, 'Unexpected cached error type')
        throw new CepToLatLonError()
      }

      // Domain errors thrown directly from processCep (first fetch)
      if (error instanceof InvalidCepError) {
        throw error
      }

      if (error instanceof CoordinatesNotFoundError) {
        throw error
      }

      if (error instanceof GeoServiceBusyError) {
        const isRateLimit = error instanceof GeoServiceBusyError
        logger.error({ cep: cleanCep, error, isRateLimit }, 'Critical failure in CepToLatLonUseCase (System Fail)')
        throw error
      }

      if (error instanceof AddressServiceBusyError) {
        const isRateLimit = error instanceof AddressServiceBusyError
        logger.error({ cep: cleanCep, error, isRateLimit }, 'Critical failure in CepToLatLonUseCase (System Fail)')
        throw error
      }

      if (error instanceof AddressProviderFailureError) {
        throw error
      }

      if (error instanceof GeoProviderFailureError) {
        throw error
      }

      if (error instanceof TimeoutExceededOnFetchError) {
        logger.warn({ cep: cleanCep }, 'Operation timed out. Bubbling up.')
        throw error
      }

      if (error instanceof ServiceOverloadError) {
        logger.warn({ cep: cleanCep }, 'Service overload (Circuit Breaker). Bubbling up.')
        throw error
      }

      // Throw user-friendly error message ("Instabilidade temporária...")
      throw new CepToLatLonError()
    }
  }

  private async processCep(cleanCep: string, signal: AbortSignal): Promise<CepToLatLonResponse> {
    // 1. Fetch Address (ViaCEP / AwesomeAPI)
    // Passing signal to ensure we respect the global/cache timeout

    let address: AddressData

    try {
      const data = await this.addressProvider.fetchAddress(cleanCep, signal)

      if (!data) {
        throw new InvalidCepError()
      }

      // 2. OPTIMIZATION: If Address Provider (AwesomeAPI) gave us coordinates, USE THEM.
      if (data.lat && data.lon) {
        return {
          userLat: data.lat,
          userLon: data.lon,
          precision: data.precision || GeoPrecision.NO_CERTAINTY,
        }
      }

      address = data
    } catch (error) {
      if (error instanceof InvalidCepError) {
        throw error
      }

      logger.error({ cep: cleanCep, error }, 'Critical: Address Providers could not find address. System error.')
      throw error
    }

    const { logradouro, localidade, uf, bairro } = address

    // 3. Geocoding Fallback Strategies

    // Strategy A: Exact Match (Street)
    if (logradouro) {
      const exact = await this.geocodingProvider.search(`${logradouro}, ${localidade} - ${uf}, Brazil`, signal)
      if (exact) return this.mapResponse(exact)
    }

    // Strategy B: Approximate Match (Neighborhood)
    if (bairro) {
      const approx = await this.geocodingProvider.search(`${bairro}, ${localidade} - ${uf}, Brazil`, signal)
      if (approx) return this.mapResponse(approx)
    }

    // Strategy C: City Fallback
    if (localidade) {
      try {
        const city = await this.geocodingProvider.searchStructured(
          {
            city: localidade,
            state: uf,
            country: 'Brazil',
          },
          signal,
        )

        if (city === null) {
          throw new CoordinatesNotFoundError()
        }

        return this.mapResponse(city)
      } catch (error) {
        if (error instanceof CoordinatesNotFoundError) {
          throw error
        }

        logger.error(
          { cep: cleanCep, city: localidade, error },
          'Critical: Geocoder could not find city. System error.',
        )
        throw error
      }
    }

    // 4. PARANOID GUARD
    // We found the address data (text) but Geocoders failed to find even the city.
    // This implies a provider failure or data inconsistency.
    logger.error({ cep: cleanCep, city: localidade }, 'Critical: Geocoder could not find city. System error.')

    // This is a system error - won't be cached
    throw new CepToLatLonError()
  }

  private mapResponse(coords: GeoCoordinates): CepToLatLonResponse {
    return {
      userLat: coords.lat,
      userLon: coords.lon,
      precision: coords.precision,
    }
  }
}
