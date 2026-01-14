import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error' // <--- Don't forget this import
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates, GeoPrecision } from 'providers/geo-provider/geo-provider.interface'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'
import { ResilientCache } from '@lib/redis/resilient-cache'
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
  ) {
    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:cep-coords:',
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour (Negative Cache)
    })
  }

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = this.cacheManager.generateKey({ cep: cleanCep })

    const result = await this.cacheManager.getOrFetch<CepToLatLonResponse>(cacheKey, async () => {
      try {
        // 1. Fetch Address
        const address = await this.addressProvider.fetchAddress(cleanCep)

        if (address.lat && address.lon) {
          return {
            userLat: address.lat,
            userLon: address.lon,
            precision: GeoPrecision.ROOFTOP,
          }
        }

        const { logradouro, bairro, localidade, uf } = address

        // 3. Geocoding Strategies
        if (logradouro) {
          const exact = await this.geocodingProvider.search(`${logradouro}, ${localidade} - ${uf}, Brazil`)
          if (exact) return this.mapResponse(exact)
        }

        if (bairro) {
          const approx = await this.geocodingProvider.search(`${bairro}, ${localidade} - ${uf}, Brazil`)
          if (approx) return this.mapResponse(approx)
        }

        const city = await this.geocodingProvider.searchStructured({
          city: localidade,
          state: uf,
          country: 'Brazil',
        })

        if (city) return this.mapResponse(city)

        // 4. PARANOID GUARD
        logger.error(
          { cep: cleanCep, city: localidade },
          'Critical: Geocoder could not find a known city. Aborting cache.',
        )

        throw new GeoProviderFailureError()
      } catch (error) {
        // === THE MISSING PIECE ===
        // If it is a logic error (Invalid CEP), return null so Redis caches it.
        // If it is a system error (Network/Paranoid), re-throw so Redis ignores it.
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
