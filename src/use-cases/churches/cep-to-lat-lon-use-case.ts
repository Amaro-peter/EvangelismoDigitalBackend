import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import axios from 'axios'

interface CepToLatLonRequest {
  cep: string
}

interface CepToLatLonResponse {
  userLat: number
  userLon: number
}

export class CepToLatLonUseCase {
  async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
    const viaCepRes = await axios.get(`https://viacep.com.br/ws/${cep}/json/`)

    if (viaCepRes.data.erro) {
      throw new InvalidCepError()
    }

    const { logradouro, localidade, uf } = viaCepRes.data
    const address = `${logradouro}, ${localidade} - ${uf}, Brazil`

    const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'jsonv2', // jsonv2 provides slightly more detail
        limit: 1,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
      },
    })

    if (!geoRes.data || geoRes.data.length === 0) {
      throw new CoordinatesNotFoundError()
    }

    const rawLat = geoRes.data[0].lat
    const rawLon = geoRes.data[0].lon

    return {
      userLat: Number.parseFloat(rawLat),
      userLon: Number.parseFloat(rawLon),
    }
  }
}
