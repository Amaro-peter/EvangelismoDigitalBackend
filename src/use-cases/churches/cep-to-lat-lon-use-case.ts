import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider } from 'providers/geo-provider/geo-provider.interface'

interface CepToLatLonRequest {
  cep: string
}

interface CepToLatLonResponse {
  userLat: number
  userLon: number
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

    let coordinates: { lat: number; lon: number } | null = null

    // STRATEGY 1: SMART FREE-TEXT SEARCH (Best precision)
    if (logradouro) {
      const fullAddress = `${logradouro}, ${localidade} - ${uf}, Brazil`
      coordinates = await this.geocodingProvider.search(fullAddress)
    }

    // STRATEGY 2: NEIGHBORHOOD FALLBACK (If street not found)
    if (!coordinates && bairro) {
      const neighborhoodAddress = `${bairro}, ${localidade} - ${uf}, Brazil`
      coordinates = await this.geocodingProvider.search(neighborhoodAddress)
    }

    // STRATEGY 3: CITY FALLBACK (Last Resort)
    if (!coordinates) {
      coordinates = await this.geocodingProvider.searchStructured({
        city: localidade,
        state: uf,
        country: 'Brazil',
      })
    }

    if (!coordinates) {
      throw new CoordinatesNotFoundError()
    }

    return {
      userLat: coordinates.lat,
      userLon: coordinates.lon,
    }
  }
}
