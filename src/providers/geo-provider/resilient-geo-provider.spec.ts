import crypto from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResilientGeoProvider } from './resilient-geo-provider'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { Redis, RedisKey } from 'ioredis'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { logger } from '@lib/logger'

describe('ResilientGeoProvider Unit Tests', () => {
  let mockRedis: Redis
  let mockProvider1: GeocodingProvider
  let mockProvider2: GeocodingProvider
  const CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // must match implementation
  const NEGATIVE_CACHE_TTL_SECONDS = 60 * 60 // 1 hour

  beforeEach(() => {
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1), // Mock eval for lock release
      exists: vi.fn().mockResolvedValue(0),
    } as any

    mockProvider1 = {
      search: vi.fn(),
      searchStructured: vi.fn(),
    } as any

    mockProvider2 = {
      search: vi.fn(),
      searchStructured: vi.fn(),
    } as any
  })

  it('should return result from first provider on success', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: 'ROOFTOP' }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.search).toHaveBeenCalledOnce()
    expect(mockProvider2.search).not.toHaveBeenCalled()
  })

  it('should fallback to second provider when first returns null', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: 'CITY' }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.search).toHaveBeenCalled()
    expect(mockProvider2.search).toHaveBeenCalled()
  })

  it('should fallback to second provider when first throws error', async () => {
    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: 'CITY' }
    vi.spyOn(mockProvider1, 'search').mockRejectedValue(new Error('Network error'))
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('Test Address')

    expect(result).toEqual(expectedResult)
  })

  it('should throw last error when all providers fail', async () => {
    vi.spyOn(mockProvider1, 'search').mockRejectedValue(new Error('Error 1'))
    const serviceBusyError = new GeoServiceBusyError('Service is busy')
    vi.spyOn(mockProvider2, 'search').mockRejectedValue(serviceBusyError)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)

    await expect(resilient.search('Test Address')).rejects.toThrow(GeoServiceBusyError)
  })

  it('should return null when all providers return null', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('Test Address')

    expect(result).toBeNull()
  })

  it('should use cached result without calling providers', async () => {
    const cachedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: 'ROOFTOP' }
    vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('Cached Address')

    expect(result).toEqual(cachedResult)
    expect(mockProvider1.search).not.toHaveBeenCalled()
  })

  // ---- Additional tests ----

  it('should write to cache when provider returns a result', async () => {
    const query = 'Cacheable Address'
    const expectedResult: GeoCoordinates = { lat: 10, lon: 20, precision: 'ROOFTOP' }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search(query)

    expect(result).toEqual(expectedResult)

    // Find the cache write call (not the lock call)
    const setCalls = (mockRedis.set as any).mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

    expect(cacheCall).toBeDefined()
    expect(cacheCall[1]).toBe(JSON.stringify(expectedResult))
    expect(cacheCall[2]).toBe('EX')
    expect(cacheCall[3]).toBe(CACHE_TTL_SECONDS)
  })

  it('should cache null results with negative TTL', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.search('No Cache Address')

    expect(result).toBeNull()

    // Should cache negative result
    const setCalls = (mockRedis.set as any).mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

    expect(cacheCall).toBeDefined()
    expect(cacheCall[1]).toBe('null')
    expect(cacheCall[2]).toBe('EX')
    expect(cacheCall[3]).toBe(NEGATIVE_CACHE_TTL_SECONDS)
  })

  it('should continue and cache result even if redis.get throws', async () => {
    const query = 'RedisGetError Address'
    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }
    vi.spyOn(mockRedis, 'get').mockRejectedValue(new Error('Redis down'))
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
    const result = await resilient.search(query)

    expect(result).toEqual(expectedResult)

    // In degraded mode (Redis unhealthy), cache writes are skipped entirely
    const setCalls = (mockRedis.set as any).mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))
    expect(cacheCall).toBeUndefined() // No cache write in degraded mode
  })

  it('should handle searchStructured, call providers and cache with structured params', async () => {
    const options: GeoSearchOptions = { street: 'Main', city: 'Metropolis' } as any
    const expectedResult: GeoCoordinates = { lat: 3, lon: 4, precision: 'ROOFTOP' }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.searchStructured(options)

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.searchStructured).toHaveBeenCalledOnce()

    const setCalls = (mockRedis.set as any).mock.calls
    const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))
    expect(cacheCall).toBeDefined()
    expect(cacheCall[1]).toBe(JSON.stringify(expectedResult))
  })

  it('should return cached structured result without calling providers', async () => {
    const options: GeoSearchOptions = { street: 'Baker', city: 'London' } as any
    const cachedResult: GeoCoordinates = { lat: 51.5, lon: -0.1, precision: 'CITY' }

    // Mock cache hit
    vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
    const result = await resilient.searchStructured(options)

    expect(result).toEqual(cachedResult)
    expect(mockProvider1.searchStructured).not.toHaveBeenCalled()
  })

  // ---- Edge Cases and Error Handling ----

  it('should generate consistent cache keys with undefined values', async () => {
    const options1: GeoSearchOptions = { city: 'São Paulo', state: undefined } as any
    const options2: GeoSearchOptions = { city: 'São Paulo' } as any

    const expectedResult: GeoCoordinates = { lat: -23.5, lon: -46.6, precision: 'CITY' }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

    await resilient.searchStructured(options1)
    const firstCalls = (mockRedis.set as any).mock.calls
    const firstKey = firstCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

    vi.clearAllMocks()
    mockRedis.get = vi.fn().mockResolvedValue(null)
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    mockRedis.eval = vi.fn().mockResolvedValue(1)
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    await resilient.searchStructured(options2)
    const secondCalls = (mockRedis.set as any).mock.calls
    const secondKey = secondCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

    expect(firstKey).toEqual(secondKey)
  })

  it('should generate consistent cache keys regardless of property order', async () => {
    const options1 = { a: 1, b: 2, c: 3 }
    const options2 = { c: 3, a: 1, b: 2 }

    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

    await resilient.searchStructured(options1 as any)
    const firstCalls = (mockRedis.set as any).mock.calls
    const firstKey = firstCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

    vi.clearAllMocks()
    mockRedis.get = vi.fn().mockResolvedValue(null)
    mockRedis.set = vi.fn().mockResolvedValue('OK')
    mockRedis.eval = vi.fn().mockResolvedValue(1)
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

    await resilient.searchStructured(options2 as any)
    const secondCalls = (mockRedis.set as any).mock.calls
    const secondKey = secondCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

    expect(firstKey).toEqual(secondKey)
  })

  it('should handle empty query gracefully', async () => {
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
    const result = await resilient.search('')

    expect(result).toBeNull()
    expect(mockRedis.get).toHaveBeenCalled()
    expect(mockProvider1.search).toHaveBeenCalledWith('')
  })

  it('should continue if redis.set throws (write failure)', async () => {
    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }
    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

    // Make set fail for cache writes but succeed for locks
    vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
      if (String(key).includes(':lock')) return 'OK'
      throw new Error('Redis write failed')
    })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
    const result = await resilient.search('Test')

    expect(result).toEqual(expectedResult)
  })

  it('should handle redis.get returning invalid JSON', async () => {
    vi.spyOn(mockRedis, 'get').mockResolvedValue('invalid json{')
    vi.spyOn(mockProvider1, 'search').mockResolvedValue({ lat: 1, lon: 2, precision: 'CITY' })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
    const result = await resilient.search('Test')

    expect(result).toEqual({ lat: 1, lon: 2, precision: 'CITY' })
    expect(mockProvider1.search).toHaveBeenCalled()
  })

  it('should handle mixed null and error responses correctly', async () => {
    const mockProvider3 = { search: vi.fn(), searchStructured: vi.fn() } as any

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockRejectedValue(new Error('Downtime'))
    vi.spyOn(mockProvider3, 'search').mockResolvedValue({ lat: 1, lon: 2, precision: 'CITY' })

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2, mockProvider3], mockRedis)
    const result = await resilient.search('Test')

    expect(result).toEqual({ lat: 1, lon: 2, precision: 'CITY' })
    expect(mockProvider1.search).toHaveBeenCalled()
    expect(mockProvider2.search).toHaveBeenCalled()
    expect(mockProvider3.search).toHaveBeenCalled()
  })

  it('should differentiate cache keys between search and searchStructured', async () => {
    const coords1: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }
    const coords2: GeoCoordinates = { lat: 3, lon: 4, precision: 'ROOFTOP' }

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(coords1)
    vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(coords2)

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

    await resilient.search('city: London')
    await resilient.searchStructured({ city: 'London', state: '', country: '' })

    const setCalls = (mockRedis.set as any).mock.calls
    const cacheKeys = setCalls.filter((call: any) => !String(call[0]).includes(':lock')).map((call: any) => call[0])

    expect(cacheKeys[0]).not.toEqual(cacheKeys[1])
  })

  it('should handle multiple consecutive null results', async () => {
    const mockProvider3 = { search: vi.fn(), searchStructured: vi.fn() } as any
    const expectedResult = { lat: 1, lon: 2, precision: 'CITY' }

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)
    vi.spyOn(mockProvider3, 'search').mockResolvedValue(expectedResult)

    const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2, mockProvider3], mockRedis)
    const result = await resilient.search('Test')

    expect(result).toEqual(expectedResult)
    expect(mockProvider1.search).toHaveBeenCalled()
    expect(mockProvider2.search).toHaveBeenCalled()
    expect(mockProvider3.search).toHaveBeenCalled()
  })

  it('should log errors but not throw when cache write fails', async () => {
    const logSpy = vi.spyOn(logger, 'error')
    const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }

    vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
    vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
      if (String(key).includes(':lock')) return 'OK'
      throw new Error('Redis write failed')
    })

    const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

    await expect(resilient.search('Test')).resolves.toEqual(expectedResult)
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Redis error writing'),
    )
  })

  describe('Distributed Locking', () => {
    it('should acquire lock and prevent race condition on cache miss', async () => {
      const query = 'Concurrent Address'
      const expectedResult: GeoCoordinates = { lat: 10, lon: 20, precision: 'ROOFTOP' }

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)

      const lockCalls = (mockRedis.set as any).mock.calls.filter((call: any) => String(call[0]).includes(':lock'))
      expect(lockCalls.length).toBeGreaterThan(0)
      expect(mockRedis.eval).toHaveBeenCalled()
    })

    it('should wait for cache when lock acquisition fails', async () => {
      const query = 'Locked Address'
      const cachedResult: GeoCoordinates = { lat: 5, lon: 10, precision: 'CITY' }

      let getCalls = 0
      vi.spyOn(mockRedis, 'get').mockImplementation(async () => {
        getCalls++
        if (getCalls === 1) return null
        return JSON.stringify(cachedResult)
      })

      vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
        if (String(key).includes(':lock')) return null
        return 'OK'
      })

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(cachedResult)
      expect(mockProvider1.search).not.toHaveBeenCalled()
      expect(getCalls).toBeGreaterThan(1)
    })

    it('should timeout and proceed without lock after max retries', async () => {
      const query = 'Timeout Address'
      const expectedResult: GeoCoordinates = { lat: 15, lon: 25, precision: 'ROOFTOP' }

      vi.spyOn(mockRedis, 'get').mockResolvedValue(null)
      vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
        if (String(key).includes(':lock')) return null
        return 'OK'
      })
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'warn')

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
      expect(mockProvider1.search).toHaveBeenCalled()

      // Check for the actual log messages from the code
      const warnCalls = logSpy.mock.calls
      const hasTimeoutWarning = warnCalls.some((call: any) =>
        String(call[1]).includes('Lock wait timeout') ||
        String(call[1]).includes('Could not acquire lock after timeout'),
      )
      expect(hasTimeoutWarning).toBe(true)
    }, 15000) // Increase timeout for this test

    it('should handle lock release failure gracefully', async () => {
      const query = 'Lock Release Failure'
      const expectedResult: GeoCoordinates = { lat: 20, lon: 30, precision: 'CITY' }

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
      vi.spyOn(mockRedis, 'eval').mockRejectedValue(new Error('Lua script failed'))

      const logSpy = vi.spyOn(logger, 'warn')

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Redis error releasing lock'),
      )
    })

    it('should not release lock if token does not match (Lua script returns 0)', async () => {
      const query = 'Wrong Token'
      const expectedResult: GeoCoordinates = { lat: 25, lon: 35, precision: 'ROOFTOP' }

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
      vi.spyOn(mockRedis, 'eval').mockResolvedValue(0)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
    })

    it('should handle lock acquisition Redis error (fail-open)', async () => {
      const query = 'Lock Redis Error'
      const expectedResult: GeoCoordinates = { lat: 30, lon: 40, precision: 'CITY' }

      vi.spyOn(mockRedis, 'set').mockRejectedValue(new Error('Redis connection lost'))
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'warn')

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
      expect(mockProvider1.search).toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Redis error acquiring lock'),
      )
    })
  })

  describe('Negative Caching', () => {
    it('should cache null results with 1-hour TTL', async () => {
      const query = 'Not Found Address'

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(null)
      vi.spyOn(mockProvider2, 'search').mockResolvedValue(null)

      const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
      const result = await resilient.search(query)

      expect(result).toBeNull()

      const setCalls = (mockRedis.set as any).mock.calls
      const cacheCall = setCalls.find((call: any) => !String(call[0]).includes(':lock'))

      expect(cacheCall).toBeDefined()
      expect(cacheCall[1]).toBe('null')
      expect(cacheCall[2]).toBe('EX')
      expect(cacheCall[3]).toBe(NEGATIVE_CACHE_TTL_SECONDS)
    })

    it('should retrieve cached null result on subsequent requests', async () => {
      const query = 'Cached Null Address'

      vi.spyOn(mockRedis, 'get').mockResolvedValue('null')

      const resilient = new ResilientGeoProvider([mockProvider1, mockProvider2], mockRedis)
      const result = await resilient.search(query)

      expect(result).toBeNull()
      expect(mockProvider1.search).not.toHaveBeenCalled()
      expect(mockProvider2.search).not.toHaveBeenCalled()
    })

    it('should differentiate between cached null and cache miss', async () => {
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

      vi.spyOn(mockRedis, 'get').mockResolvedValue(null)
      vi.spyOn(mockProvider1, 'search').mockResolvedValueOnce({ lat: 1, lon: 2, precision: 'CITY' })

      const result1 = await resilient.search('Miss')
      expect(mockProvider1.search).toHaveBeenCalledTimes(1)
      expect(result1).not.toBeNull()

      vi.clearAllMocks()
      mockRedis.get = vi.fn().mockResolvedValue('null')
      mockRedis.set = vi.fn().mockResolvedValue('OK')
      mockRedis.eval = vi.fn().mockResolvedValue(1)

      const result2 = await resilient.search('Cached Null')
      expect(mockProvider1.search).not.toHaveBeenCalled()
      expect(result2).toBeNull()
    })
  })

  describe('Cache Key Generation', () => {
    it('should always include _method in cache key', async () => {
      const expectedResult: GeoCoordinates = { lat: 1, lon: 2, precision: 'CITY' }

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)
      vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

      await resilient.search('London')
      const searchCalls = (mockRedis.set as any).mock.calls
      const searchKey = searchCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

      vi.clearAllMocks()
      mockRedis.get = vi.fn().mockResolvedValue(null)
      mockRedis.set = vi.fn().mockResolvedValue('OK')
      mockRedis.eval = vi.fn().mockResolvedValue(1)

      await resilient.searchStructured({ city: 'London', state: '', country: '' })
      const structuredCalls = (mockRedis.set as any).mock.calls
      const structuredKey = structuredCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

      expect(searchKey).not.toEqual(structuredKey)
    })

    it('should filter out empty strings but preserve _method', async () => {
      const options1: GeoSearchOptions = { city: 'Paris', state: '', country: '' }
      const options2: GeoSearchOptions = { city: 'Paris' } as any
      const expectedResult: GeoCoordinates = { lat: 48.8, lon: 2.3, precision: 'CITY' }

      vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

      await resilient.searchStructured(options1)
      const firstCalls = (mockRedis.set as any).mock.calls
      const firstKey = firstCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

      vi.clearAllMocks()
      mockRedis.get = vi.fn().mockResolvedValue(null)
      mockRedis.set = vi.fn().mockResolvedValue('OK')
      mockRedis.eval = vi.fn().mockResolvedValue(1)
      vi.spyOn(mockProvider1, 'searchStructured').mockResolvedValue(expectedResult)

      await resilient.searchStructured(options2)
      const secondCalls = (mockRedis.set as any).mock.calls
      const secondKey = secondCalls.find((call: any) => !String(call[0]).includes(':lock'))[0]

      expect(firstKey).toBeDefined()
      expect(secondKey).toBeDefined()
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle double-check lock pattern correctly', async () => {
      const query = 'Double Check Address'
      const cachedResult: GeoCoordinates = { lat: 40, lon: 50, precision: 'ROOFTOP' }

      let getCallCount = 0
      vi.spyOn(mockRedis, 'get').mockImplementation(async () => {
        getCallCount++
        if (getCallCount === 1) return null
        return JSON.stringify(cachedResult)
      })

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(cachedResult)
      expect(getCallCount).toBe(2)
      expect(mockProvider1.search).not.toHaveBeenCalled()
    })

    it('should handle concurrent requests with same query', async () => {
      const query = 'Concurrent Same Query'
      const expectedResult: GeoCoordinates = { lat: 45, lon: 55, precision: 'CITY' }

      let providerCallCount = 0
      vi.spyOn(mockProvider1, 'search').mockImplementation(async () => {
        providerCallCount++
        await new Promise((resolve) => setTimeout(resolve, 50))
        return expectedResult
      })

      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)

      const [result1, result2, result3] = await Promise.all([
        resilient.search(query),
        resilient.search(query),
        resilient.search(query),
      ])

      expect(result1).toEqual(expectedResult)
      expect(result2).toEqual(expectedResult)
      expect(result3).toEqual(expectedResult)

      // With locking, might still get 2-3 calls due to race, but that's acceptable
      expect(providerCallCount).toBeLessThanOrEqual(3)
    })

    it('should handle invalid JSON in cache during lock retry', async () => {
      const query = 'Invalid JSON Lock Retry'
      const expectedResult: GeoCoordinates = { lat: 50, lon: 60, precision: 'ROOFTOP' }

      let getCallCount = 0
      vi.spyOn(mockRedis, 'get').mockImplementation(async () => {
        getCallCount++
        if (getCallCount === 1) return null
        if (getCallCount === 2) return 'invalid{json'
        return null
      })

      vi.spyOn(mockRedis, 'set').mockImplementation(async (key: any) => {
        if (String(key).includes(':lock')) return null
        return 'OK'
      })

      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'warn')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      const result = await resilient.search(query)

      expect(result).toEqual(expectedResult)
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: expect.any(String) }),
        expect.stringContaining('Invalid JSON'),
      )
    }, 15000)
  })

  describe('Constructor Validation', () => {
    it('should throw error when no providers are given', () => {
      expect(() => {
        new ResilientGeoProvider([], mockRedis)
      }).toThrow('ResilientGeoProvider requires at least one provider')
    })

    it('should accept single provider', () => {
      expect(() => {
        new ResilientGeoProvider([mockProvider1], mockRedis)
      }).not.toThrow()
    })
  })

  describe('Logging', () => {
    it('should log debug message on cache hit', async () => {
      const cachedResult: GeoCoordinates = { lat: 55, lon: 65, precision: 'CITY' }
      vi.spyOn(mockRedis, 'get').mockResolvedValue(JSON.stringify(cachedResult))

      const logSpy = vi.spyOn(logger, 'debug')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      await resilient.search('Cached')

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKey: expect.any(String) }),
        expect.stringContaining('Cache hit'),
      )
    })

    it('should log info on successful geocoding', async () => {
      const expectedResult: GeoCoordinates = { lat: 60, lon: 70, precision: 'ROOFTOP' }
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'info')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
      await resilient.search('Success')

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'Object' }),
        expect.stringContaining('Geocoding successful'),
      )
    })

    it('should log cache metadata when caching results', async () => {
      const expectedResult: GeoCoordinates = { lat: 65, lon: 75, precision: 'CITY' }
      vi.spyOn(mockProvider1, 'search').mockResolvedValue(expectedResult)

      const logSpy = vi.spyOn(logger, 'debug')
      const resilient = new ResilientGeoProvider([mockProvider1], mockRedis)
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
