import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates, GeoPrecision } from 'providers/geo-provider/geo-provider.interface'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'

interface CepToLatLonRequest {
  cep: string
}

interface CepToLatLonResponse {
  userLat: number
  userLon: number
  precision: GeoPrecision
}

export class CepToLatLonUseCase {
  private readonly CACHE_PREFIX = 'cache:cep-coords:'
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days

  constructor(
    private geocodingProvider: GeocodingProvider,
    private addressProvider: AddressProvider,
    private redis: Redis,
  ) {}

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = `${this.CACHE_PREFIX}${cleanCep}`

    // ==========================================
    // STEP 1: Check Unified CEP → Coordinates Cache
    // ==========================================
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        logger.info({ cep: cleanCep }, 'Coordenadas recuperadas do cache unificado')
        return JSON.parse(cached) as CepToLatLonResponse
      }
    } catch (err) {
      logger.error({ error: err }, 'Erro ao ler cache unificado do Redis')
    }

    // ==========================================
    // STEP 2: Fetch Address Data (with its own cache layer)
    // ==========================================
    const addressData = await this.addressProvider.fetchAddress(cleanCep)

    // ==========================================
    // STEP 3: Fast Path - Provider Already Has Coordinates
    // ==========================================
    if (addressData.lat && addressData.lon) {
      const response: CepToLatLonResponse = {
        userLat: addressData.lat,
        userLon: addressData.lon,
        // AwesomeAPI retorna centro da cidade para CEPs genéricos, ou rua para específicos.
        precision: addressData.logradouro
          ? GeoPrecision.ROOFTOP
          : addressData.bairro
            ? GeoPrecision.NEIGHBORHOOD
            : GeoPrecision.CITY,
      }

      // Save to unified cache
      await this.saveToCache(cacheKey, response)
      return response
    }

    // ==========================================
    // STEP 4: Geocoding Fallback Strategies (Nominatim with its own cache)
    // ==========================================
    const { logradouro, localidade, uf, bairro } = addressData
    let geoResult: GeoCoordinates | null = null

    // STRATEGY 1: SMART FREE-TEXT SEARCH
    if (logradouro) {
      const fullAddress = `${logradouro}, ${localidade} - ${uf}, Brazil`
      geoResult = await this.geocodingProvider.search(fullAddress)
    }

    // STRATEGY 2: NEIGHBORHOOD FALLBACK
    if (!geoResult && bairro) {
      const neighborhoodAddress = `${bairro}, ${localidade} - ${uf}, Brazil`
      geoResult = await this.geocodingProvider.search(neighborhoodAddress)
    }

    // STRATEGY 3: CITY FALLBACK
    if (!geoResult) {
      geoResult = await this.geocodingProvider.searchStructured({
        city: localidade,
        state: uf,
        country: 'Brazil',
      })
    }

    if (!geoResult) {
      throw new CoordinatesNotFoundError()
    }

    const response: CepToLatLonResponse = {
      userLat: geoResult.lat,
      userLon: geoResult.lon,
      precision: geoResult.precision,
    }

    // ==========================================
    // STEP 5: Save Final Result to Unified Cache
    // ==========================================
    await this.saveToCache(cacheKey, response)

    return response
  }

  private async saveToCache(key: string, data: CepToLatLonResponse): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(data), 'EX', this.CACHE_TTL_SECONDS)
      logger.info({ key }, 'Coordenadas salvas no cache unificado')
    } catch (err) {
      logger.error({ error: err }, 'Erro ao salvar coordenadas no cache do Redis')
    }
  }
}
