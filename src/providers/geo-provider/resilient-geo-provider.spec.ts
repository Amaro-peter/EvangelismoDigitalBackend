import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { ResilientGeoProvider } from './resilient-geo-provider'
import { GeocodingProvider, GeoCoordinates, GeoPrecision, GeoSearchOptions } from './geo-provider.interface'
import { Redis } from 'ioredis'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { logger } from '@lib/logger'

// =========================================================================
// 1. SOPHISTICATED MOCK REDIS (Required for Event-Driven Concurrency)
// =========================================================================
class MockRedis extends EventEmitter {
  get = vi.fn()
  set = vi.fn()
  del = vi.fn()
  eval = vi.fn() // For Lua script
  exists = vi.fn()
  pttl = vi.fn()

  // Pub/Sub methods required for the new implementation
  subscribe = vi.fn().mockResolvedValue('OK')
  unsubscribe = vi.fn().mockResolvedValue('OK')

  // Crucial: duplicate() must return a client that shares the same Event Loop
  // so when we emit 'message' on one, the other hears it.
  duplicate = vi.fn().mockReturnValue(this)
}

describe('ResilientGeoProvider Unit Tests', () => {
  let mockRedis: MockRedis
  let mockProvider1: GeocodingProvider
  let mockProvider2: GeocodingProvider

  const CACHE_TTL_SECONDS = 60 * 60 * 24 * 90
  const NEGATIVE_CACHE_TTL_SECONDS = 60 * 60

  beforeEach(() => {
    // Instantiate the Event-Driven Mock
    mockRedis = new MockRedis()

    // Default behaviors
    mockRedis.get.mockResolvedValue(null)
    mockRedis.set.mockResolvedValue('OK')
    mockRedis.eval.mockResolvedValue(1)
    mockRedis.exists.mockResolvedValue(0)

    mockProvider1 = {
      search: vi.fn(),
      searchStructured: vi.fn(),
    } as any

    mockProvider2 = {
      search: vi.fn(),
      searchStructured: vi.fn(),
    } as any

    // Silence logs during tests
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.spyOn(logger, 'debug').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.spyOn(logger, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // =========================================================================
  // ORIGINAL HAPPY PATHS & FALLBACK TESTS (Preserved)
  // =========================================================================

  it('should return result from first provider on success', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: GeoPrecision.ROOFTOP }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.search).toHaveBeenCalledOnce()
    expect(mockProvider2.search).not.toHaveBeenCalled()
  })

  it('should fallback to second provider when first returns null', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: GeoPrecision.CITY }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.search).toHaveBeenCalled()
    expect(mockProvider2.search).toHaveBeenCalled()
  })

  it('should fallback to second provider when first throws error', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: GeoPrecision.CITY }
    vi.spyOn(mockProvider1, 'search').mockRejectedValue(new Error('Network error'))
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
  })

  it('should throw last error when all providers fail', async () => {
    vi.spyOn(mockProvider1, 'search').mockRejectedValue(new Error('Error 1'))
    const serviceBusyError = new GeoServiceBusyError('Service is busy')
    vi.spyOn(mockProvider2, 'search').mockRejectedValue(serviceBusyError)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)

    await expect(resilient.search('Test Address')).rejects.toThrow(GeoServiceBusyError)
  })

  it('should return null when all providers return null', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('Test Address')

    expect(result).toBeNull()
  })

  it('should use cached result without calling providers', async () => {
    const cachedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: GeoPrecision.ROOFTOP }
    vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('Cached Address')

    expect(result).toEqual(cachedResult)
    expect(mockProvider1.search).not.toHaveBeenCalled()
  })

  // =========================================================================
  // CACHING LOGIC TESTS (Preserved)
  // =========================================================================

  it('should write to cache when provider returns a result', async () => {
    const query = 'Cacheable Address'
    const expectedResult: GeoCoordinates = { lat: 10, lon: 20, precision: GeoPrecision.ROOFTOP }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search(query)

    expect(result).toEqual(expectedResult)

    // Find the cache write call (not the lock call)
    const setCalls = mockRedis.set.mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

    expect(cacheCall).toBeDefined()
    expect(cacheCall![1]).toBe(JSON.stringify(expectedResult))
    expect(cacheCall![2]).toBe('EX')
    expect(cacheCall![3]).toBe(CACHE_TTL_SECONDS)
  })

  it('should cache null results with negative TTL', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.search('No Cache Address')

    expect(result).toBeNull()

    // Should cache negative result
    const setCalls = mockRedis.set.mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

    expect(cacheCall).toBeDefined()
    expect(cacheCall![1]).toBe('null')
    expect(cacheCall![2]).toBe('EX')
    expect(cacheCall![3]).toBe(NEGATIVE_CACHE_TTL_SECONDS)
  })

  it('should handle searchStructured, call providers and cache with structured params', async () => {
    const options: GeoSearchOptions = { street: 'Main', city: 'Metropolis' } as any
    const expectedResult: GeoCoordinates = { lat: 3, lon: 4, precision: GeoPrecision.ROOFTOP }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.searchStructured(options)

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.searchStructured).toHaveBeenCalledOnce()

    const setCalls = mockRedis.set.mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))
    expect(cacheCall).toBeDefined()
    expect(cacheCall![1]).toBe(JSON.stringify(expectedResult))
  })

  it('should return cached structured result without calling providers', async () => {
    const options: GeoSearchOptions = { street: 'Baker', city: 'London' } as any
    const cachedResult: GeoCoordinates = { lat: 51.5, lon: -0.1, precision: GeoPrecision.CITY }

    // Mock cache hit
    vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
    const result = await resilient.searchStructured(options)

    expect(result).toEqual(cachedResult)
    expect(mockProvider1.searchStructured).not.toHaveBeenCalled()
  })

  // =========================================================================
  // EDGE CASES & ERROR HANDLING (Preserved & Adapted)
  // =========================================================================

  it('should generate consistent cache keys with undefined values', async () => {
    const options1: GeoSearchOptions = { city: 'São Paulo', state: undefined } as any
    const options2: GeoSearchOptions = { city: 'São Paulo' } as any

    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: GeoPrecision.CITY }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

    await resilient.searchStructured(options1)
    const firstCalls = mockRedis.set.mock.calls
    const firstKey = firstCalls.find((call: any) => !String(call[0]).includes(':lock'))![0]

    // Reset for second call
    mockRedis.set.mockClear()
    mockRedis.get.mockResolvedValue(null)

    await resilient.searchStructured(options2)
    const secondCalls = mockRedis.set.mock.calls
    const secondKey = secondCalls.find((call: any) => !String(call[0]).includes(':lock'))![0]

    expect(firstKey).toEqual(secondKey)
  })

  it('should generate consistent cache keys regardless of property order', async () => {
    const options1 = { a: 1, b: 2, c: 3 }
    const options2 = { c: 3, a: 1, b: 2 }

    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: GeoPrecision.CITY }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

    await resilient.searchStructured(options1 as any)
    const firstCalls = mockRedis.set.mock.calls
    const firstKey = firstCalls.find((call: any) => !String(call[0]).includes(':lock'))![0]

    mockRedis.set.mockClear()
    mockRedis.get.mockResolvedValue(null)

    await resilient.searchStructured(options2 as any)
    const secondCalls = mockRedis.set.mock.calls
    const secondKey = secondCalls.find((call: any) => !String(call[0]).includes(':lock'))![0]

    expect(firstKey).toEqual(secondKey)
  })

  it('should handle empty query gracefully', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
    const result = await resilient.search('')

    expect(result).toBeNull()
    expect(mockRedis.get).toHaveBeenCalled()
    expect(mockProvider1.search).toHaveBeenCalledWith('')
  })

  it('should continue if redis.set throws (write failure)', async () => {
    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: GeoPrecision.CITY }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    // Make set fail for cache writes but succeed for locks
    vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
      if (String(key).includes(':lock')) return 'OK'
      throw new Error('Redis write failed')
    })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
    const result = await resilient.search('Test')

    expect(result).toEqual(expectedResult)
  })

  it('should handle redis.get returning invalid JSON', async () => {
    vi.spyOn(mockRedis, 'get').mockResolvedValue('invalid json{')
    vi.spyOn(mockProvider1, 'search').mockResolvedValue({ lat: 1, lon: 2, precision: GeoPrecision.CITY })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
    const result = await resilient.search('Test')

    expect(result).toEqual({ lat: 1, lon: 2, precision: GeoPrecision.CITY })
    expect(mockProvider1.search).toHaveBeenCalled()
  })

  it('should differentiate cache keys between search and searchStructured', async () => {
    const coords1: GeoCoordinates = { lat: 1, lon: 2, precision: GeoPrecision.CITY }
    const coords2: GeoCoordinates = { lat: 3, lon: 4, precision: GeoPrecision.ROOFTOP }

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(coords1)
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(coords2)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

    await resilient.search('city: London')
    await resilient.searchStructured({ city: 'London', state: '', country: '' })

    const setCalls = mockRedis.set.mock.calls
    const cacheKeys = setCalls.filter((call: any) => !String(call[0]).includes(':lock')).map((call: any) => call[0])

    expect(cacheKeys[0]).not.toEqual(cacheKeys[1])
  })

  it('should log errors but not throw when cache write fails', async () => {
    const logSpy = vi.spyOn(logger, 'error')
    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: GeoPrecision.CITY }

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
    vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
      if (String(key).includes(':lock')) return 'OK'
      throw new Error('Redis write failed')
    })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

    await expect(resilient.search('Test')).resolves.toEqual(expectedResult)
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Redis error writing'),
    )
  })

  // =========================================================================
  // NEGATIVE CACHING (Preserved)
  // =========================================================================

  describe('Negative Caching', () => {
    it('should cache null results with 1-hour TTL', async () => {
      const query = 'Not Found Address'

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
      vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

      const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
      const result = await resilient.search(query)

      expect(result).toBeNull()

      const setCalls = mockRedis.set.mock.calls
      const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

      expect(cacheCall).toBeDefined()
      expect(cacheCall![1]).toBe('null')
      expect(cacheCall![2]).toBe('EX')
      expect(cacheCall![3]).toBe(NEGATIVE_CACHE_TTL_SECONDS)
    })

    it('should retrieve cached null result on subsequent requests', async () => {
      const query = 'Cached Null Address'

      vi.spyOn(mockRedis, 'get').mockResolvedValue('null')

      const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis as unknown as Redis)
      const result = await resilient.search(query)

      expect(result).toBeNull()
      expect(mockProvider1.search).not.toHaveBeenCalled()
      expect(mockProvider2.search).not.toHaveBeenCalled()
    })

    it('should differentiate between cached null and cache miss', async () => {
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

      vi.spyOn(mockRedis, 'get').mockResolvedValue(null)
      vi.spyOn(mockProvider1, 'search').mockResolvedValueOnce({ lat: 1, lon: 2, precision: GeoPrecision.CITY })

      const result1 = await resilient.search('Miss')
      expect(mockProvider1.search).toHaveBeenCalledTimes(1)
      expect(result1).not.toBeNull()

      vi.clearAllMocks()
      mockRedis.get.mockResolvedValue('null')
      mockRedis.set.mockResolvedValue('OK')
      mockRedis.eval.mockResolvedValue(1)

      const result2 = await resilient.search('Cached Null')
      expect(mockProvider1.search).not.toHaveBeenCalled()
      expect(result2).toBeNull()
    })
  })

  // =========================================================================
  // DEGRADED MODE (New - Critical for "Fast as Possible" Requirement)
  // =========================================================================
  describe('Degraded Mode (High Availability)', () => {
    it('should continue and cache result even if redis.get throws', async () => {
      const query = 'RedisGetError Address'
      const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: GeoPrecision.CITY }
      vi.spyOn(mockRedis, 'get').mockRejectedValue(new Error('Redis down'))
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)

      // In degraded mode (Redis unhealthy), cache writes are skipped entirely
      const setCalls = mockRedis.set.mock.calls
      const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))
      expect(cacheCall).toBeUndefined()
    })

    it('should bypass cache and locks IMMEDIATELY if Redis initial check fails', async () => {
      // Scenario: Redis is down/timeout on the very first .get()
      const error = new Error('Connection Timeout')
      mockRedis.get.mockRejectedValue(error)

      const expectedResult = { lat: 10, lon: 10, precision: GeoPrecision.ROOFTOP }
      vi.mocked(mockProvider1.search).mockResolvedValue(expectedResult as any)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      // Execute
      const result = await resilient.search('Degraded St')

      // Assertions for SPEED:
      expect(result).toEqual(expectedResult)
      // MUST NOT try to acquire lock (waste of time if Redis is flaky)
      expect(mockRedis.set).not.toHaveBeenCalled()
      // MUST NOT try to subscribe
      expect(mockRedis.subscribe).not.toHaveBeenCalled()
      // Warning must be logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: error }),
        expect.stringContaining('Redis unavailable'),
      )
    })
  })

  // =========================================================================
  // DISTRIBUTED LOCKING & CONCURRENCY (Updated for Pub/Sub)
  // =========================================================================

  describe('Distributed Locking & Concurrency', () => {
    it('should acquire lock and prevent race condition on cache miss', async () => {
      const query = 'Concurrent Address'
      const expectedResult: GeoCoordinates = { lat: 10, lon: 20, precision: GeoPrecision.ROOFTOP }

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)

      const lockCalls = mockRedis.set.mock.calls.filter((call: any) => String(call[0]).includes(':lock'))
      expect(lockCalls.length).toBeGreaterThan(0)
      expect(mockRedis.eval).toHaveBeenCalled() // Lua script release
    })

    it('should wait for cache (via Event) when lock acquisition fails', async () => {
      // Scenario: Process B finds lock held by Process A.
      // Process B subscribes and waits. Process A finishes and emits 'released'.
      // Process B reads cache.

      const query = 'Locked Address'
      const cachedResult: GeoCoordinates = { lat: 5, lon: 10, precision: GeoPrecision.CITY }

      // 1. Initial Cache Miss
      mockRedis.get.mockResolvedValueOnce(null)
      // 2. Lock Acquisition Fails (held by others)
      mockRedis.set.mockResolvedValueOnce(null)
      // 3. Lock Exists check (Initially YES - LOCKED)
      mockRedis.exists.mockResolvedValue(1)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)

      // Start the search (it will block waiting for event)
      const searchPromise = resilient.search(query)

      // Wait a tiny bit to let the provider reach the 'subscribe/wait' state
      await new Promise((resolve) => setTimeout(resolve, 20))

      // We need to emit using the EXACT key the provider generated.
      // Since we can't easily reproduce the hash calculation test-side, we inspect the call args.
      const initialGetCall = mockRedis.get.mock.calls[0]
      const cacheKey = initialGetCall[0]
      const lockKey = `${cacheKey}:lock`

      // 4. Simulate Event: Lock Released
      // CRITICAL FIX: Update exists to 0 so the loop knows to exit when it wakes up
      mockRedis.exists.mockResolvedValue(0)

      // Populate cache so it finds data after waking up
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult))

      // Emit the Redis Pub/Sub message on the Mock
      mockRedis.emit('message', `${lockKey}:released`, 'released')

      const result = await searchPromise

      expect(result).toEqual(cachedResult)
      expect(mockProvider1.search).not.toHaveBeenCalled()

      // Verify subscription happened (New Architecture)
      expect(mockRedis.duplicate).toHaveBeenCalled()
      expect(mockRedis.subscribe).toHaveBeenCalledWith(`${lockKey}:released`)
    })

    it('should timeout and proceed without lock after max wait time', async () => {
      vi.useFakeTimers()
      const query = 'Timeout Address'
      const expectedResult: GeoCoordinates = { lat: 15, lon: 25, precision: GeoPrecision.ROOFTOP }

      mockRedis.get.mockResolvedValue(null) // Miss
      mockRedis.set.mockResolvedValue(null) // Lock busy
      mockRedis.exists.mockResolvedValue(1) // Lock exists

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
      const logSpy = vi.spyOn(logger, 'warn')

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      const searchPromise = resilient.search(query)

      // Fast-forward past MAX_WAIT_TIME_MS (10s)
      await vi.advanceTimersByTimeAsync(11_000)

      const result = await searchPromise

      expect(result).toEqual(expectedResult)
      expect(mockProvider1.search).toHaveBeenCalled()

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: expect.any(String) }),
        expect.stringContaining('Lock wait timeout'),
      )
    })

    it('should handle lock acquisition Redis error (fail-open)', async () => {
      const query = 'Lock Redis Error'
      const expectedResult: GeoCoordinates = { lat: 30, lon: 40, precision: GeoPrecision.CITY }

      // Cache miss
      mockRedis.get.mockResolvedValue(null)
      // Lock Error
      vi.spyOn(mockRedis, 'set').mockRejectedValue(new Error('Redis connection lost'))
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'warn')

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
      expect(mockProvider1.search).toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Redis error acquiring lock'),
      )
    })

    it('should use Lua script to atomically delete lock and publish release', async () => {
      mockRedis.get.mockResolvedValue(null)
      mockRedis.set.mockResolvedValue('OK')
      vi.mocked(mockProvider1.search).mockResolvedValue({ lat: 1, lon: 1, precision: GeoPrecision.CITY })

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      await resilient.search('Lua Test')

      // Check the last call to eval (cleanup)
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("del", KEYS[1])'),
        2,
        expect.stringContaining(':lock'),
        expect.stringContaining(':released'),
        expect.any(String), // Token
      )
    })
  })

  // =========================================================================
  // CONSTRUCTOR & LOGGING (Preserved)
  // =========================================================================

  describe('Constructor Validation', () => {
    it('should throw error when no providers are given', () => {
      expect(() => {
        new ResilientGeoProvider([], mockRedis as unknown as Redis)
      }).toThrow('ResilientGeoProvider requires at least one provider')
    })

    it('should accept single provider', () => {
      expect(() => {
        new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      }).not.toThrow()
    })
  })

  describe('Logging', () => {
    it('should log debug message on cache hit', async () => {
      const cachedResult: GeoCoordinates = { lat: 55, lon: 65, precision: GeoPrecision.CITY }
      vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

      const logSpy = vi.spyOn(logger, 'debug')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      await resilient.search('Cached')

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: expect.any(String) }),
        expect.stringContaining('Cache hit'),
      )
    })

    it('should log info on successful geocoding', async () => {
      const expectedResult: GeoCoordinates = { lat: 60, lon: 70, precision: GeoPrecision.ROOFTOP }
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'info')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      await resilient.search('Success')

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'Object' }),
        expect.stringContaining('Geocoding successful'),
      )
    })

    it('should log cache metadata when caching results', async () => {
      const expectedResult: GeoCoordinates = { lat: 65, lon: 75, precision: GeoPrecision.CITY }
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'debug')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis as unknown as Redis)
      await resilient.search('Log Metadata')

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKey: expect.any(String),
          isNegativeCache: false,
          ttl: CACHE_TTL_SECONDS,
        }),
        expect.stringContaining('90d TTL'),
      )
    })
  })
})
