import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates, GeoPrecision } from 'providers/geo-provider/geo-provider.interface'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
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
    const cacheOptions: ResilientCacheOptions = {
      prefix: optionsOverride.prefix,
      defaultTtlSeconds: optionsOverride.defaultTtlSeconds,
      negativeTtlSeconds: optionsOverride.negativeTtlSeconds,
      maxPendingFetches: optionsOverride.maxPendingFetches,
      fetchTimeoutMs: optionsOverride.fetchTimeoutMs,
    }

    this.cacheManager = new ResilientCache(redis, cacheOptions)
  }

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = this.cacheManager.generateKey({ cep: cleanCep })

    // [CRITICAL] Capture the signal from the cache manager
    const result = await this.cacheManager.getOrFetch<CepToLatLonResponse>(cacheKey, async (signal) => {
      try {
        // 1. Fetch Address (Pass signal down)
        const address = await this.addressProvider.fetchAddress(cleanCep, signal)

        if (address.lat && address.lon) {
          return {
            userLat: address.lat,
            userLon: address.lon,
            precision: address.logradouro
              ? GeoPrecision.ROOFTOP
              : address.bairro
                ? GeoPrecision.NEIGHBORHOOD
                : GeoPrecision.CITY,
          }
        }

        const { logradouro, bairro, localidade, uf } = address

        // 3. Geocoding Strategies (Pass signal down)
        // Note: Ensure your GeocodingProvider interface also accepts signal!
        if (logradouro) {
          const exact = await this.geocodingProvider.search(
            `${logradouro}, ${localidade} - ${uf}, Brazil`,
            signal, // <--- Pass signal
          )
          if (exact) return this.mapResponse(exact)
        }

        if (bairro) {
          const approx = await this.geocodingProvider.search(
            `${bairro}, ${localidade} - ${uf}, Brazil`,
            signal, // <--- Pass signal
          )
          if (approx) return this.mapResponse(approx)
        }

        const city = await this.geocodingProvider.searchStructured(
          {
            city: localidade,
            state: uf,
            country: 'Brazil',
          },
          signal,
        )

        if (city) return this.mapResponse(city)

        // 4. PARANOID GUARD
        logger.error(
          { cep: cleanCep, city: localidade },
          'Critical: Geocoder could not find a known city. Aborting cache.',
        )

        throw new GeoProviderFailureError()
      } catch (error) {
        // Logic vs System error handling
        if (error instanceof InvalidCepError) {
          return null
        }
        throw error
      }
    })

    if (!result) {
      throw new CoordinatesNotFoundError()
    }

    return result
  }

  private mapResponse(geo: GeoCoordinates): CepToLatLonResponse {
    return {
      userLat: geo.lat,
      userLon: geo.lon,
      precision: geo.precision,
    }
  }
}
