import { app } from 'app'
import { AwesomeApiProvider } from 'providers/address-provider/awesome-api-provider'
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { LocationIqProvider } from 'providers/geo-provider/location-iq-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRedisCacheConnection } from '@lib/redis/redis-cache-connection'

// NOTE: This test suite hits REAL APIs for the "OK" scenarios.
// It mocks ONLY the failures to force the fallback logic to execute.

const redisConnection = createRedisCacheConnection()

describe('Real Geocoding Fallback Scenarios (e2e)', () => {
  beforeAll(async () => {
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await redisConnection.quit()
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    // Ensure cache is clear between tests to prevent pollution
    const keys = await redisConnection.keys('cache:*')
    if (keys.length > 0) {
      await redisConnection.del(...keys)
    }
  })

  // Known Valid CEP (Av. Paulista, SP)
  const VALID_CEP = '01310100'
  // Invalid CEP
  const INVALID_CEP = '00000000'

  // ==============================================================================
  // 1. AwesomeProvider OK
  // ==============================================================================
  it('Scenario 1: AwesomeProvider OK (Fast Path)', async () => {
    // We spy to verify it was called, but we do NOT mock the implementation.
    // It should hit the real AwesomeAPI.
    const spyAwesome = vi.spyOn(AwesomeApiProvider.prototype, 'fetchAddress')
    const spyViaCep = vi.spyOn(ViaCepProvider.prototype, 'fetchAddress')

    const response = await request(app.server).get('/churches/nearest').query({ cep: VALID_CEP })

    expect(response.statusCode).toEqual(200)
    expect(response.body.churches).toBeDefined()

    // Assertions
    expect(spyAwesome).toHaveBeenCalled()
    expect(spyViaCep).not.toHaveBeenCalled() // Should Short-Circuit

    console.log('Scenario 1 Result:', 'AwesomeAPI returned coordinates successfully.')
  }, 10000)

  // ==============================================================================
  // 2. AwesomeProvider fail -> ViaCepProvider fail
  // ==============================================================================
  it('Scenario 2: Awesome Fail -> ViaCep Fail (Invalid CEP)', async () => {
    // For this scenario, we use a naturally INVALID CEP.
    // Real APIs will return 400/404 or "erro: true".

    const spyAwesome = vi
      .spyOn(AwesomeApiProvider.prototype, 'fetchAddress')
      .mockRejectedValue(new Error('Simulated AwesomeAPI Failure'))
    const spyViaCep = vi.spyOn(ViaCepProvider.prototype, 'fetchAddress')

    const response = await request(app.server).get('/churches/nearest').query({ cep: INVALID_CEP })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)

    // Both should have been attempted
    expect(spyAwesome).toHaveBeenCalled()
    expect(spyViaCep).toHaveBeenCalled()

    console.log('Scenario 2 Result:', 'Both providers correctly identified invalid CEP.')
  }, 10000)

  // ==============================================================================
  // 3. AwesomeProvider fail -> ViaCepProvider ok -> LocationIQ ok
  // ==============================================================================
  it('Scenario 3: Awesome Fail -> ViaCep OK -> LocationIQ OK', async () => {
    // 1. Force AwesomeAPI to fail (simulate downtime)
    const spyAwesome = vi
      .spyOn(AwesomeApiProvider.prototype, 'fetchAddress')
      .mockRejectedValue(new Error('Simulated AwesomeAPI Downtime'))

    // 2. Let ViaCep run normally (Real API)
    const spyViaCep = vi.spyOn(ViaCepProvider.prototype, 'fetchAddress')

    // 3. Let LocationIQ run normally (Real API)
    const spyLocationIq = vi.spyOn(LocationIqProvider.prototype, 'search')
    const spyNominatim = vi.spyOn(NominatimGeoProvider.prototype, 'search')

    const response = await request(app.server).get('/churches/nearest').query({ cep: VALID_CEP })

    expect(response.statusCode).toEqual(200)

    // Validation
    expect(spyAwesome).toHaveBeenCalled()
    expect(spyViaCep).toHaveBeenCalled() // Fallback to ViaCep
    expect(spyLocationIq).toHaveBeenCalled() // ViaCep has no coords, so Geo needed. Priority 1 is IQ.
    expect(spyNominatim).not.toHaveBeenCalled() // IQ succeeded, no need for Nominatim.

    console.log('Scenario 3 Result:', 'Fallback to ViaCEP + LocationIQ successful.')
  }, 20000)

  // ==============================================================================
  // 4. Awesome fail -> ViaCep ok -> LocationIQ fail -> Nominatim ok
  // ==============================================================================
  it('Scenario 4: Awesome Fail -> ViaCep OK -> LocationIQ Fail -> Nominatim OK', async () => {
    // 1. Force Awesome Fail
    vi.spyOn(AwesomeApiProvider.prototype, 'fetchAddress').mockRejectedValue(new Error('Simulated AwesomeAPI Downtime'))

    // 2. Force LocationIQ Fail (Simulate Rate Limit)
    const spyLocationIq = vi
      .spyOn(LocationIqProvider.prototype, 'search')
      .mockRejectedValue(new Error('Simulated LocationIQ Rate Limit'))

    // 3. Spies for others (Real Execution)
    const spyViaCep = vi.spyOn(ViaCepProvider.prototype, 'fetchAddress')
    const spyNominatim = vi.spyOn(NominatimGeoProvider.prototype, 'search')

    const response = await request(app.server).get('/churches/nearest').query({ cep: VALID_CEP })

    expect(response.statusCode).toEqual(200)

    // Validation
    expect(spyViaCep).toHaveBeenCalled()
    expect(spyLocationIq).toHaveBeenCalled() // Tried IQ
    expect(spyNominatim).toHaveBeenCalled() // Fallback to Nominatim executed!

    console.log('Scenario 4 Result:', 'Deep fallback to Nominatim successful.')
  }, 25000)

  // ==============================================================================
  // 5. Awesome fail -> ViaCep ok -> LocationIQ fail-> Nominatim fail
  // ==============================================================================
  it('Scenario 5: Everything Fails', async () => {
    // Mock EVERYTHING to fail
    vi.spyOn(AwesomeApiProvider.prototype, 'fetchAddress').mockRejectedValue(new Error('Down'))
    // ViaCep actually succeeds fetching address string, but Geocoders fail
    vi.spyOn(LocationIqProvider.prototype, 'search').mockRejectedValue(new Error('Down'))
    vi.spyOn(NominatimGeoProvider.prototype, 'search').mockRejectedValue(new Error('Down'))

    // We expect 400 because ViaCep returns address, but we fail to convert it to Coords
    const response = await request(app.server).get('/churches/nearest').query({ cep: VALID_CEP })

    // Expecting error because coordinates could not be resolved
    expect(response.statusCode).toBeGreaterThanOrEqual(400)

    console.log('Scenario 5 Result:', 'System correctly handled total geocoding failure.')
  }, 10000)
})
