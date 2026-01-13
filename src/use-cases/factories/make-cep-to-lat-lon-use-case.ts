import { CepToLatLonUseCase } from '@use-cases/churches/cep-to-lat-lon-use-case'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { AwesomeApiProvider } from 'providers/address-provider/awesome-api-provider'
import { ResilientAddressProvider } from 'providers/address-provider/resilient-address-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import { redisConnection } from '@lib/redis/connection'

export function makeCepToLatLonUseCase() {
  // 1. Setup Geocoding Provider (with its own cache)
  const geoProvider = new NominatimGeoProvider(redisConnection)

  // 2. Setup Address Providers
  const awesomeApiProvider = new AwesomeApiProvider()
  const viaCepProvider = new ViaCepProvider()

  // 3. Setup Resilient Address Provider (Fallback Strategy + Address Cache)
  // Order: AwesomeAPI (has lat/lon) -> ViaCEP (fallback)
  const resilientAddressProvider = new ResilientAddressProvider([awesomeApiProvider, viaCepProvider], redisConnection)

  // 4. Create Use Case with Unified CEP→Coordinates Cache
  const cepToLatLonUseCase = new CepToLatLonUseCase(geoProvider, resilientAddressProvider, redisConnection)

  return cepToLatLonUseCase
}
