import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates, GeoPrecision } from 'providers/geo-provider/geo-provider.interface'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'
import { ResilientCache, ResilientCacheOptions } from '@lib/redis/helper/resilient-cache'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'

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

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse | null> {
    const cleanCep = cep.replace(/\D/g, '')

    const cacheKey = this.cacheManager.generateKey({ cep: cleanCep })

    try {
      // 1. Get from Cache OR Fetch
      const result = await this.cacheManager.getOrFetch<CepToLatLonResponse | null>(cacheKey, async (signal) => {
        try {
          // CRITICAL: Passing signal down to business logic
          return await this.processCep(cleanCep, signal)
        } catch (error) {
          // === NEGATIVE CACHING STRATEGY ===
          // If the CEP is invalid, we return null.
          // ResilientCache will store this 'null' with a negative TTL (short duration).
          // This prevents us from spamming providers for known bad data.
          if (error instanceof InvalidCepError) {
            return null
          }

          // For System Errors (Timeouts, Rate Limits, 500s), we THROW.
          // This ensures ResilientCache does NOT cache the failure, allowing retries.
          throw error
        }
      })

      // 2. Handle "Not Found" / Negative Cache Hit
      if (!result) {
        throw new CoordinatesNotFoundError()
      }

      return result
    } catch (error) {
      // 3. Domain Errors: Bubble up to Controller (400/404)
      if (error instanceof InvalidCepError) throw error
      if (error instanceof CoordinatesNotFoundError) throw error

      // 4. System Errors: Log and return friendly "Instability" message
      const isRateLimit = error instanceof GeoServiceBusyError

      logger.error({ cep: cleanCep, error, isRateLimit }, 'Critical failure in CepToLatLonUseCase (System Fail)')

      // Throw the error containing the friendly user message ("Instabilidade temporária...")
      throw new GeoProviderFailureError()
    }
  }

  private async processCep(cleanCep: string, signal: AbortSignal): Promise<CepToLatLonResponse | null> {
    // 1. Fetch Address (ViaCEP / AwesomeAPI)
    // Passing signal to ensure we respect the global/cache timeout
    const address = await this.addressProvider.fetchAddress(cleanCep, signal)

    if (!address) {
      return null // Will be cached as null (Negative Cache)
    }

    // 2. OPTIMIZATION: If Address Provider (AwesomeAPI) gave us coordinates, USE THEM.
    if (address.lat && address.lon) {
      return {
        userLat: address.lat,
        userLon: address.lon,
        // Heuristic: If street is present, it's Rooftop precision. If only neighborhood, Neighborhood precision.
        precision: address.logradouro
          ? GeoPrecision.ROOFTOP
          : address.bairro
            ? GeoPrecision.NEIGHBORHOOD
            : GeoPrecision.CITY,
      }
    }

    const { logradouro, localidade, uf, bairro } = address

    // 3. Geocoding Fallback Strategies
    // [CRITICAL] Passing 'signal' to every search call

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
    // We found the address data (text) but Geocoders failed to find even the city.
    // This implies a provider failure or data inconsistency.
    logger.error({ cep: cleanCep, city: localidade }, 'Critical: Geocoder could not find a known city. Aborting cache.')

    // Throwing here triggers the logic in `execute`:
    // It is NOT caught by `if (error instanceof InvalidCepError)`, so it bubbles up.
    // `execute` catches it and throws `GeoProviderFailureError` (Instability message).
    // The cache is NOT updated (correct behavior for system instability).
    throw new GeoProviderFailureError()
  }

  private mapResponse(coords: GeoCoordinates): CepToLatLonResponse {
    return {
      userLat: coords.lat,
      userLon: coords.lon,
      precision: coords.precision,
    }
  }
}
