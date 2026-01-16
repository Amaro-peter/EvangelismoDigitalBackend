import { CepToLatLonUseCase } from '@use-cases/churches/cep-to-lat-lon-use-case'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { AwesomeApiProvider } from 'providers/address-provider/awesome-api-provider'
import { ResilientAddressProvider } from 'providers/address-provider/resilient-address-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import { LocationIqProvider } from 'providers/geo-provider/location-iq-provider'
import { ResilientGeoProvider } from 'providers/geo-provider/resilient-geo-provider'
import { redisConnection } from '@lib/redis/connection'
import { env } from '@env/index'

// 1. Variable to hold the singleton instance
let cachedUseCase: CepToLatLonUseCase | null = null

export function makeCepToLatLonUseCase() {
  // 2. Return the existing instance if it has already been created
  if (cachedUseCase) {
    return cachedUseCase
  }

  // Setup Geocoding Providers
  const nominatimProvider = new NominatimGeoProvider(redisConnection, {
    apiUrl: env.NOMINATIM_API_URL,
  })

  const locationIqProvider = new LocationIqProvider(redisConnection, {
    apiUrl: env.LOCATION_IQ_API_URL,
    apiToken: env.LOCATION_IQ_API_TOKEN,
  })

  // Setup Resilient Geo Strategy
  const resilientGeoProvider = new ResilientGeoProvider([locationIqProvider, nominatimProvider], redisConnection, {
    prefix: 'cache:geocoding:',
    defaultTtlSeconds: 60 * 60 * 24 * 7, // 7 days
    negativeTtlSeconds: 60 * 30, // 30 minutes (Negative Cache)
    maxPendingFetches: 500,
    fetchTimeoutMs: 12000,
  })

  // Setup Address Providers
  const awesomeApiProvider = new AwesomeApiProvider({
    apiUrl: env.AWESOME_API_URL,
    apiToken: env.AWESOME_API_TOKEN,
  })

  const viaCepProvider = new ViaCepProvider({
    apiUrl: env.VIACEP_API_URL,
  })

  const resilientAddressProvider = new ResilientAddressProvider([awesomeApiProvider, viaCepProvider], redisConnection, {
    prefix: 'cache:cep:',
    defaultTtlSeconds: 60 * 60 * 24 * 7, // 7 days
    negativeTtlSeconds: 60 * 30, // 30 minutes
    maxPendingFetches: 500,
    fetchTimeoutMs: 8000,
  })

  // Create Use Case
  cachedUseCase = new CepToLatLonUseCase(resilientGeoProvider, resilientAddressProvider, redisConnection, {
    prefix: 'cache:cep-coords:',
    defaultTtlSeconds: 60 * 60 * 24 * 7, // 7 days
    negativeTtlSeconds: 60 * 30, // 30 minutes (Negative Cache)
    maxPendingFetches: 500,
    fetchTimeoutMs: 25000,
  })

  // 3. Return the new singleton
  return cachedUseCase
}
