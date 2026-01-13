import { CepToLatLonUseCase } from '@use-cases/churches/cep-to-lat-lon-use-case'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import { redisConnection } from '@lib/redis/connection'

export function makeCepToLatLonUseCase() {
  const geoProvider = new NominatimGeoProvider(redisConnection)
  const viaCepProvider = new ViaCepProvider(redisConnection)

  const cepToLatLonUseCase = new CepToLatLonUseCase(geoProvider, viaCepProvider)

  return cepToLatLonUseCase
}
