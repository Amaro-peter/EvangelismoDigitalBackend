import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoCoordinates } from 'providers/geo-provider/geo-provider.interface'

interface CepToLatLonRequest {
  cep: string
}

interface CepToLatLonResponse {
  userLat: number
  userLon: number
  precision: 'ROOFTOP' | 'NEIGHBORHOOD' | 'CITY'
}

export class CepToLatLonUseCase {
  constructor(
    private geocodingProvider: GeocodingProvider,
    private viaCepProvider: AddressProvider,
  ) {}

  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    // 1. FETCH ADDRESS INFO (ViaCEP)
    const addressData = await this.viaCepProvider.fetchAddress(cep)

    const { logradouro, localidade, uf, bairro } = addressData

    let geoResult: GeoCoordinates | null = null

    // STRATEGY 1: SMART FREE-TEXT SEARCH (Best precision)
    if (logradouro) {
      const fullAddress = `${logradouro}, ${localidade} - ${uf}, Brazil`
      geoResult = await this.geocodingProvider.search(fullAddress)
    }

    // STRATEGY 2: NEIGHBORHOOD FALLBACK (If street not found)
    if (!geoResult && bairro) {
      const neighborhoodAddress = `${bairro}, ${localidade} - ${uf}, Brazil`
      geoResult = await this.geocodingProvider.search(neighborhoodAddress)
    }

    // STRATEGY 3: CITY FALLBACK (Last Resort)
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

    return {
      userLat: geoResult.lat,
      userLon: geoResult.lon,
      precision: geoResult.precision,
    }
  }
}
