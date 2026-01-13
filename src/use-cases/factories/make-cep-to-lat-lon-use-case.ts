import { CepToLatLonUseCase } from '@use-cases/churches/cep-to-lat-lon-use-case'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { AwesomeApiProvider } from 'providers/address-provider/awesome-api-provider'
import { ResilientAddressProvider } from 'providers/address-provider/resilient-address-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import { redisConnection } from '@lib/redis/connection'
import { env } from '@env/index'

export function makeCepToLatLonUseCase() {
  // 1. Setup Geocoding Provider (with config & cache)
  const geoProvider = new NominatimGeoProvider(redisConnection, {
    apiUrl: env.GEOCODING_API_URL,
  })

  // 2. Setup Address Providers (with config)
  const awesomeApiProvider = new AwesomeApiProvider({
    apiUrl: env.AWESOME_API_URL,
    apiToken: env.AWESOME_API_TOKEN,
  })

  const viaCepProvider = new ViaCepProvider({
    apiUrl: env.VIACEP_API_URL,
  })

  // 3. Setup Resilient Address Provider (Fallback Strategy + Address Cache)
  const resilientAddressProvider = new ResilientAddressProvider([awesomeApiProvider, viaCepProvider], redisConnection)

  // 4. Create Use Case
  const cepToLatLonUseCase = new CepToLatLonUseCase(geoProvider, resilientAddressProvider, redisConnection)

  return cepToLatLonUseCase
}
