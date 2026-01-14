import { CepToLatLonUseCase } from '@use-cases/churches/cep-to-lat-lon-use-case'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { AwesomeApiProvider } from 'providers/address-provider/awesome-api-provider'
import { ResilientAddressProvider } from 'providers/address-provider/resilient-address-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import { LocationIqProvider } from 'providers/geo-provider/location-iq-provider'
import { ResilientGeoProvider } from 'providers/geo-provider/resilient-geo-provider'
import { redisConnection } from '@lib/redis/connection'
import { env } from '@env/index'

export function makeCepToLatLonUseCase() {
  // 1. Setup Geocoding Providers (Stateless/Rate-Limited only)
  const nominatimProvider = new NominatimGeoProvider(redisConnection, {
    apiUrl: env.NOMINATIM_API_URL,
  })

  const locationIqProvider = new LocationIqProvider(redisConnection, {
    apiUrl: env.LOCATION_IQ_API_URL,
    apiToken: env.LOCATION_IQ_API_TOKEN,
  })

  // 2. Setup Resilient Geo Strategy (Centralized Caching here)
  const resilientGeoProvider = new ResilientGeoProvider(
    [locationIqProvider, nominatimProvider],
    redisConnection, // Inject Redis for the unified cache
  )

  // 3. Setup Address Providers
  const awesomeApiProvider = new AwesomeApiProvider({
    apiUrl: env.AWESOME_API_URL,
    apiToken: env.AWESOME_API_TOKEN,
  })

  const viaCepProvider = new ViaCepProvider({
    apiUrl: env.VIACEP_API_URL,
  })

  const resilientAddressProvider = new ResilientAddressProvider([awesomeApiProvider, viaCepProvider], redisConnection)

  // 4. Create Use Case (L1 Cache)
  const cepToLatLonUseCase = new CepToLatLonUseCase(resilientGeoProvider, resilientAddressProvider, redisConnection)

  return cepToLatLonUseCase
}
