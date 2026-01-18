// Mock environment variables FIRST
vi.mock('@lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'http://localhost',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    APP_NAME: 'Test',
    APP_PORT: 3000,
    JWT_SECRET: 'x'.repeat(60),
    FRONTEND_URL: 'http://localhost:5173',
    HASH_SALT_ROUNDS: 12,
    SMTP_EMAIL: 'test@example.com',
    SMTP_PASSWORD: 'test',
    SMTP_PORT: 465,
    SMTP_HOST: 'smtp.test.com',
    SMTP_SECURE: true,
    ADMIN_EMAIL: 'admin@example.com',
    AWESOME_API_URL: 'http://awesomeapi.test',
    AWESOME_API_TOKEN: 'token',
    VIACEP_API_URL: 'http://viacep.test',
    NOMINATIM_API_URL: 'http://nominatim.test',
    LOCATION_IQ_API_URL: 'http://locationiq.test',
    LOCATION_IQ_API_TOKEN: 'token',
    SENTRY_DSN: '',
  },
}))

// Mock logger to avoid noise in test output
vi.mock('@lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}))

import axios from 'axios'
import { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRedisCacheConnection } from '@lib/redis/redis-cache-connection'
import { ResilientCache, CachedFailureError } from './resilient-cache'
import { ServiceOverloadError } from '../errors/service-overload-error'
import { TimeoutExceedOnFetchError } from '../errors/timeout-exceed-on-fetch-error'
import { OperationAbortedError } from '../errors/operation-aborted-error'

describe('ResilientCache - Integration Tests', () => {
  let redis: Redis
  let cache: ResilientCache

  beforeAll(async () => {
    redis = createRedisCacheConnection()
  })

  afterAll(async () => {
    await redis.quit()
  })

  beforeEach(async () => {
    // Clear all test cache keys
    const keys = await redis.keys('test:*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }

    // Create fresh cache instance for each test
    cache = new ResilientCache(redis, {
      prefix: 'test:',
      defaultTtlSeconds: 60,
      negativeTtlSeconds: 10,
      maxPendingFetches: 10,
      fetchTimeoutMs: 2000,
      ttlJitterPercentage: 0.05,
    })

    vi.clearAllMocks()
  })

  // ============================================================================
  // BASIC FUNCTIONALITY TESTS
  // ============================================================================

  describe('Basic Cache Operations', () => {
    it('should generate stable cache keys', () => {
      const key1 = cache.generateKey({ cep: '01310100', userId: '123' })
      const key2 = cache.generateKey({ userId: '123', cep: '01310100' })

      expect(key1).toBe(key2)
      expect(key1).toMatch(/^test:[a-f0-9]{64}$/)
    })

    it('should fetch and cache a successful result', async () => {
      const key = 'test:fetch-success'
      const fetcher = vi.fn().mockResolvedValue({ data: 'success' })

      const result = await cache.getOrFetch(key, fetcher)

      expect(result).toEqual({ data: 'success' })
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Verify it was cached in Redis
      const cached = await redis.get(key)
      expect(cached).toBeTruthy()
      const envelope = JSON.parse(cached!)
      expect(envelope).toEqual({
        s: true,
        v: { data: 'success' },
      })
    })

    it('should return cached value on second call', async () => {
      const key = 'test:cached-value'
      const fetcher = vi.fn().mockResolvedValue({ data: 'cached' })

      // First call - should fetch
      const result1 = await cache.getOrFetch(key, fetcher)
      expect(result1).toEqual({ data: 'cached' })
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      const result2 = await cache.getOrFetch(key, fetcher)
      expect(result2).toEqual({ data: 'cached' })
      expect(fetcher).toHaveBeenCalledTimes(1) // Not called again
    })

    it('should handle null results', async () => {
      const key = 'test:null-result'
      const fetcher = vi.fn().mockResolvedValue(null)

      const result = await cache.getOrFetch(key, fetcher)

      expect(result).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Verify null is cached
      const cached = await redis.get(key)
      expect(cached).toBeTruthy()
      const envelope = JSON.parse(cached!)
      expect(envelope).toEqual({
        s: true,
        v: null,
      })
    })
  })

  // ============================================================================
  // ERROR CACHING TESTS
  // ============================================================================

  describe('Error Caching with errorMapper', () => {
    it('should cache business errors when errorMapper returns metadata', async () => {
      const key = 'test:business-error'
      const errorMapper = (error: unknown) => {
        if (error instanceof Error && error.message === 'Invalid CEP') {
          return {
            type: 'InvalidCepError',
            message: error.message,
            data: { cep: '00000000' },
          }
        }
        return null
      }

      const fetcher = vi.fn().mockRejectedValue(new Error('Invalid CEP'))

      // First call - should fetch and cache error
      await expect(cache.getOrFetch(key, fetcher, errorMapper)).rejects.toThrow(CachedFailureError)
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Verify error is cached
      const cached = await redis.get(key)
      expect(cached).toBeTruthy()
      const envelope = JSON.parse(cached!)
      expect(envelope).toEqual({
        s: false,
        e: {
          type: 'InvalidCepError',
          message: 'Invalid CEP',
          data: { cep: '00000000' },
        },
      })

      // Second call - should return cached error without calling fetcher
      await expect(cache.getOrFetch(key, fetcher, errorMapper)).rejects.toThrow(CachedFailureError)
      expect(fetcher).toHaveBeenCalledTimes(1) // Still only 1 call
    })

    it('should NOT cache system errors when errorMapper returns null', async () => {
      const key = 'test:system-error'
      const errorMapper = (error: unknown) => {
        // Only cache InvalidCepError, not other errors
        if (error instanceof Error && error.message === 'Invalid CEP') {
          return { type: 'InvalidCepError', message: error.message }
        }
        return null
      }

      const fetcher = vi.fn().mockRejectedValue(new Error('Network failure'))

      await expect(cache.getOrFetch(key, fetcher, errorMapper)).rejects.toThrow('Network failure')
      expect(fetcher).toHaveBeenCalledTimes(1)

      // Verify nothing was cached
      const cached = await redis.get(key)
      expect(cached).toBeNull()
    })

    it('should retrieve cached error and throw CachedFailureError', async () => {
      const key = 'test:cached-error-retrieval'

      // Manually insert a cached error
      await redis.set(
        key,
        JSON.stringify({
          s: false,
          e: {
            type: 'InvalidCepError',
            message: 'CEP not found',
            data: { code: 404 },
          },
        }),
        'EX',
        60,
      )

      const fetcher = vi.fn()

      try {
        await cache.getOrFetch(key, fetcher)
        expect.fail('Should have thrown CachedFailureError')
      } catch (error) {
        expect(error).toBeInstanceOf(CachedFailureError)
        const cachedError = error as CachedFailureError
        expect(cachedError.errorType).toBe('InvalidCepError')
        expect(cachedError.message).toBe('CEP not found')
        expect(cachedError.errorData).toEqual({ code: 404 })
      }

      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // DEDUPLICATION & RACE CONDITION TESTS
  // ============================================================================

  describe('Request Deduplication', () => {
    it('should deduplicate concurrent requests for same key', async () => {
      const key = 'test:dedup-same-key'
      let callCount = 0

      const fetcher = vi.fn(async (signal: AbortSignal) => {
        callCount++
        await sleep(100)
        if (signal.aborted) throw new Error('Aborted')
        return { count: callCount }
      })

      // Fire 5 concurrent requests WITHOUT await - they start simultaneously
      const promise1 = cache.getOrFetch(key, fetcher)
      const promise2 = cache.getOrFetch(key, fetcher)
      const promise3 = cache.getOrFetch(key, fetcher)
      const promise4 = cache.getOrFetch(key, fetcher)
      const promise5 = cache.getOrFetch(key, fetcher)

      const results = await Promise.all([promise1, promise2, promise3, promise4, promise5])

      // All should get same result
      expect(results).toHaveLength(5)
      results.forEach((r) => expect(r).toEqual({ count: 1 }))

      // Fetcher should only be called once
      expect(callCount).toBe(1)
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple different keys concurrently', async () => {
      const keys = ['test:key1', 'test:key2', 'test:key3']
      const callCounts = { key1: 0, key2: 0, key3: 0 }

      const createFetcher = (keyName: string) => {
        return vi.fn(async () => {
          await sleep(50)
          callCounts[keyName as keyof typeof callCounts]++
          return { key: keyName, count: callCounts[keyName as keyof typeof callCounts] }
        })
      }

      const fetchers = {
        key1: createFetcher('key1'),
        key2: createFetcher('key2'),
        key3: createFetcher('key3'),
      }

      // Fire concurrent requests for different keys WITHOUT await
      const p1 = cache.getOrFetch(keys[0], fetchers.key1)
      const p2 = cache.getOrFetch(keys[1], fetchers.key2)
      const p3 = cache.getOrFetch(keys[2], fetchers.key3)
      const p4 = cache.getOrFetch(keys[0], fetchers.key1) // Duplicate key1
      const p5 = cache.getOrFetch(keys[1], fetchers.key2) // Duplicate key2

      const results = await Promise.all([p1, p2, p3, p4, p5])

      expect(results[0]).toEqual({ key: 'key1', count: 1 })
      expect(results[3]).toEqual({ key: 'key1', count: 1 }) // Same as first
      expect(callCounts.key1).toBe(1)
      expect(callCounts.key2).toBe(1)
      expect(callCounts.key3).toBe(1)
    })

    it('should handle race condition with cache expiration during dedup', async () => {
      const key = 'test:race-expiration'
      let fetchCount = 0

      const fetcher = vi.fn(async () => {
        fetchCount++
        await sleep(150)
        return { fetch: fetchCount }
      })

      // Pre-populate cache with short TTL
      await redis.set(key, JSON.stringify({ s: true, v: { fetch: 0 } }), 'EX', 1)

      // Wait for cache to expire
      await sleep(1100)

      // Now fire concurrent requests after expiration WITHOUT await
      const p1 = cache.getOrFetch(key, fetcher)
      const p2 = cache.getOrFetch(key, fetcher)
      const p3 = cache.getOrFetch(key, fetcher)

      const results = await Promise.all([p1, p2, p3])

      // Should deduplicate even after cache expiration
      expect(fetchCount).toBe(1)
      results.forEach((r) => expect(r).toEqual({ fetch: 1 }))
    })
  })

  // ============================================================================
  // TIMEOUT & ABORT SIGNAL TESTS
  // ============================================================================

  describe('Timeout and Abort Handling', () => {
    it('should timeout slow fetchers', async () => {
      const slowCache = new ResilientCache(redis, {
        prefix: 'test:',
        defaultTtlSeconds: 60,
        negativeTtlSeconds: 10,
        maxPendingFetches: 10,
        fetchTimeoutMs: 200, // Very short timeout
        ttlJitterPercentage: 0,
      })

      const key = 'test:timeout'
      const fetcher = vi.fn(async (signal: AbortSignal) => {
        await sleep(500) // Slower than timeout
        if (signal.aborted) throw new Error('Aborted')
        return { data: 'slow' }
      })

      await expect(slowCache.getOrFetch(key, fetcher)).rejects.toThrow(TimeoutExceedOnFetchError)

      // Should not cache timed-out requests
      const cached = await redis.get(key)
      expect(cached).toBeNull()
    })

    it('should respect parent AbortSignal', async () => {
      const key = 'test:parent-abort'
      const controller = new AbortController()

      const fetcher = vi.fn(async (signal: AbortSignal) => {
        await sleep(100)
        if (signal.aborted) throw new Error('Aborted')
        return { data: 'test' }
      })

      // Abort after 50ms
      setTimeout(() => controller.abort(new Error('User cancelled')), 50)

      await expect(cache.getOrFetch(key, fetcher, undefined, controller.signal)).rejects.toThrow('User cancelled')
    })

    it('should handle fetcher that respects abort signal', async () => {
      const key = 'test:abort-respected'
      let abortHandled = false

      const fetcher = async (signal: AbortSignal) => {
        return new Promise<{ data: string }>((resolve, reject) => {
          const timeout = setTimeout(() => resolve({ data: 'done' }), 500)

          signal.addEventListener('abort', () => {
            clearTimeout(timeout)
            abortHandled = true
            reject(signal.reason || new Error('Aborted'))
          })
        })
      }

      const controller = new AbortController()
      const promise = cache.getOrFetch(key, fetcher, undefined, controller.signal)

      // Abort immediately (give a tiny delay to ensure listener is attached)
      await sleep(10)
      controller.abort(new OperationAbortedError())

      await expect(promise).rejects.toThrow(OperationAbortedError)
      expect(abortHandled).toBe(true)
    })

    it('should properly cancel axios requests on timeout', async () => {
      const axiosCache = new ResilientCache(redis, {
        prefix: 'test:',
        defaultTtlSeconds: 60,
        negativeTtlSeconds: 10,
        maxPendingFetches: 10,
        fetchTimeoutMs: 100, // Timeout curto
        ttlJitterPercentage: 0,
      })

      const key = 'test:axios-timeout'
      let axiosCancelled = false

      const fetcher = async (signal: AbortSignal) => {
        try {
          // Simula requisição lenta (delay de 1s > 100ms timeout)
          await axios.get('https://httpbin.org/delay/1', { signal })
          return { data: 'success' }
        } catch (error) {
          if (axios.isCancel(error)) {
            axiosCancelled = true
          }
          throw error
        }
      }

      await expect(axiosCache.getOrFetch(key, fetcher)).rejects.toThrow(TimeoutExceedOnFetchError)

      // Axios deve ter cancelado a requisição
      expect(axiosCancelled).toBe(true)
    })
  })

  // ============================================================================
  // OVERLOAD PROTECTION TESTS
  // ============================================================================

  describe('Service Overload Protection', () => {
    it('should reject requests when max pending fetches exceeded', async () => {
      const limitedCache = new ResilientCache(redis, {
        prefix: 'test:',
        defaultTtlSeconds: 60,
        negativeTtlSeconds: 10,
        maxPendingFetches: 3, // Low limit
        fetchTimeoutMs: 5000,
        ttlJitterPercentage: 0,
      })

      const slowFetcher = async () => {
        await sleep(200)
        return { data: 'slow' }
      }

      // Start 3 slow requests (at the limit) WITHOUT await
      const p1 = limitedCache.getOrFetch('test:slow1', slowFetcher)
      const p2 = limitedCache.getOrFetch('test:slow2', slowFetcher)
      const p3 = limitedCache.getOrFetch('test:slow3', slowFetcher)

      // Give them a moment to register in pendingFetches
      await sleep(10)

      // 4th request should be rejected
      await expect(limitedCache.getOrFetch('test:slow4', slowFetcher)).rejects.toThrow(ServiceOverloadError)

      // Wait for ongoing requests to complete
      await Promise.all([p1, p2, p3])
    })

    it('should allow new requests after pending fetches complete', async () => {
      const limitedCache = new ResilientCache(redis, {
        prefix: 'test:',
        defaultTtlSeconds: 60,
        negativeTtlSeconds: 10,
        maxPendingFetches: 2,
        fetchTimeoutMs: 5000,
        ttlJitterPercentage: 0,
      })

      const fetcher = async () => {
        await sleep(100)
        return { data: 'test' }
      }

      // Fill up to limit WITHOUT await
      const p1 = limitedCache.getOrFetch('test:req1', fetcher)
      const p2 = limitedCache.getOrFetch('test:req2', fetcher)

      // Give them a moment to register
      await sleep(10)

      // Should reject
      await expect(limitedCache.getOrFetch('test:req3', fetcher)).rejects.toThrow(ServiceOverloadError)

      // Wait for completion
      await Promise.all([p1, p2])

      // Should now accept new requests
      const result = await limitedCache.getOrFetch('test:req4', fetcher)
      expect(result).toEqual({ data: 'test' })
    })
  })

  // ============================================================================
  // REDIS FAILURE RESILIENCE TESTS
  // ============================================================================

  describe('Redis Failure Resilience', () => {
    it('should continue functioning when Redis get fails', async () => {
      const key = 'test:redis-get-fail'

      // Temporarily break Redis get
      const originalGet = redis.get.bind(redis)
      redis.get = vi.fn().mockRejectedValue(new Error('Redis connection lost'))

      const fetcher = vi.fn().mockResolvedValue({ data: 'fallback' })
      const result = await cache.getOrFetch(key, fetcher)

      expect(result).toEqual({ data: 'fallback' })
      expect(fetcher).toHaveBeenCalled()

      // Restore Redis
      redis.get = originalGet
    })

    it('should continue functioning when Redis set fails', async () => {
      const key = 'test:redis-set-fail'

      // Temporarily break Redis set
      const originalSet = redis.set.bind(redis)
      redis.set = vi.fn().mockRejectedValue(new Error('Redis write failed'))

      const fetcher = vi.fn().mockResolvedValue({ data: 'success' })
      const result = await cache.getOrFetch(key, fetcher)

      // Should still return result even though caching failed
      expect(result).toEqual({ data: 'success' })
      expect(fetcher).toHaveBeenCalled()

      // Restore Redis
      redis.set = originalSet
    })

    it('should handle corrupted cache data gracefully', async () => {
      const key = 'test:corrupted-cache'

      // Insert corrupted data
      await redis.set(key, 'this is not valid JSON', 'EX', 60)

      const fetcher = vi.fn().mockResolvedValue({ data: 'fresh' })
      const result = await cache.getOrFetch(key, fetcher)

      expect(result).toEqual({ data: 'fresh' })
      expect(fetcher).toHaveBeenCalled()
    })

    it('should handle success envelope missing value', async () => {
      const key = 'test:corrupted-success'

      // Insert success envelope without value (v is undefined, not missing key)
      await redis.set(key, JSON.stringify({ s: true }), 'EX', 60)

      const fetcher = vi.fn()

      // Should throw error about corrupted cache
      await expect(cache.getOrFetch(key, fetcher)).rejects.toThrow('Corrupted cache: success envelope missing value')

      // Fetcher should not be called because we threw before reaching fetch logic
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // REAL-WORLD SCENARIO TESTS
  // ============================================================================

  describe('Real-World Scenarios', () => {
    it('Scenario: Multiple users requesting same CEP simultaneously', async () => {
      const cep = '01310100'
      const key = cache.generateKey({ cep })
      let apiCallCount = 0

      const simulateApiCall = async (signal: AbortSignal) => {
        apiCallCount++
        await sleep(150) // Simulate API latency
        if (signal.aborted) throw new Error('Aborted')
        return {
          cep,
          logradouro: 'Av. Paulista',
          lat: -23.561414,
          lon: -46.65618,
        }
      }

      // Simulate 100 concurrent users requesting same CEP WITHOUT await
      const promises: Array<Promise<any>> = []
      for (let i = 0; i < 100; i++) {
        promises.push(cache.getOrFetch(key, simulateApiCall))
      }

      const results = await Promise.all(promises)

      // All users should get same result
      results.forEach((result) => {
        expect(result).toEqual({
          cep,
          logradouro: 'Av. Paulista',
          lat: -23.561414,
          lon: -46.65618,
        })
      })

      // API should only be called once (deduplication)
      expect(apiCallCount).toBe(1)
    })

    it('Scenario: Sequential requests with cached invalid CEP', async () => {
      const invalidCep = '99999999'
      const key = cache.generateKey({ cep: invalidCep })

      const errorMapper = (error: unknown) => {
        if (error instanceof Error && error.message.includes('CEP not found')) {
          return {
            type: 'InvalidCepError',
            message: error.message,
            data: { cep: invalidCep },
          }
        }
        return null
      }

      let apiCallCount = 0
      const fetcher = async () => {
        apiCallCount++
        throw new Error('CEP not found in database')
      }

      // First request - should call API and cache error
      await expect(cache.getOrFetch(key, fetcher, errorMapper)).rejects.toThrow(CachedFailureError)
      expect(apiCallCount).toBe(1)

      // Subsequent requests - should return cached error
      for (let i = 0; i < 5; i++) {
        await expect(cache.getOrFetch(key, fetcher, errorMapper)).rejects.toThrow(CachedFailureError)
      }

      // API should still only have been called once
      expect(apiCallCount).toBe(1)
    })

    it('Scenario: Mixed valid and invalid CEPs under load', async () => {
      const validCeps = ['01310100', '20040020', '30130100']
      const invalidCeps = ['00000000', '99999999']

      const errorMapper = (error: unknown) => {
        if (error instanceof Error && error.message === 'Invalid CEP') {
          return { type: 'InvalidCepError', message: error.message }
        }
        return null
      }

      const createFetcher = (cep: string, isValid: boolean) => {
        return async () => {
          await sleep(Math.random() * 100) // Simulate variable latency
          if (!isValid) throw new Error('Invalid CEP')
          return { cep, data: `Address for ${cep}` }
        }
      }

      const requests = [
        ...validCeps.map((cep) => cache.getOrFetch(cache.generateKey({ cep }), createFetcher(cep, true))),
        ...invalidCeps.map((cep) =>
          cache.getOrFetch(cache.generateKey({ cep }), createFetcher(cep, false), errorMapper),
        ),
      ]

      const results = await Promise.allSettled(requests)

      // Valid CEPs should succeed
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      expect(results[2].status).toBe('fulfilled')

      // Invalid CEPs should be rejected
      expect(results[3].status).toBe('rejected')
      expect(results[4].status).toBe('rejected')
    })

    it('Scenario: Cache stampede prevention on expiration', async () => {
      const key = 'test:stampede'
      let fetchCount = 0

      const fetcher = async () => {
        fetchCount++
        await sleep(100)
        return { fetch: fetchCount, timestamp: Date.now() }
      }

      // Initial population
      await cache.getOrFetch(key, fetcher)
      expect(fetchCount).toBe(1)

      // Clear the cache manually to simulate expiration
      await redis.del(key)

      // Simulate stampede - 200 concurrent requests after expiration WITHOUT await
      const promises: Array<Promise<any>> = []
      for (let i = 0; i < 200; i++) {
        promises.push(cache.getOrFetch(key, fetcher))
      }
      await Promise.all(promises)

      // Should still only fetch once due to deduplication
      expect(fetchCount).toBe(2) // Initial + 1 after expiration
    })
  })

  // ============================================================================
  // TTL & JITTER TESTS
  // ============================================================================

  describe('TTL and Jitter', () => {
    it('should apply different TTLs for success vs failure', async () => {
      const successKey = 'test:success-ttl'
      const failureKey = 'test:failure-ttl'

      const errorMapper = (error: unknown) => {
        if (error instanceof Error) {
          return { type: 'TestError', message: error.message }
        }
        return null
      }

      // Success case
      await cache.getOrFetch(successKey, async () => ({ data: 'success' }))

      // Failure case
      await expect(
        cache.getOrFetch(
          failureKey,
          async () => {
            throw new Error('Test')
          },
          errorMapper,
        ),
      ).rejects.toThrow(CachedFailureError)

      // Check TTLs
      const successTtl = await redis.ttl(successKey)
      const failureTtl = await redis.ttl(failureKey)

      // Success should have longer TTL (~60s)
      expect(successTtl).toBeGreaterThan(50)
      expect(successTtl).toBeLessThanOrEqual(63) // 60 + 5% jitter

      // Failure should have shorter TTL (~10s)
      expect(failureTtl).toBeGreaterThan(5)
      expect(failureTtl).toBeLessThanOrEqual(11) // 10 + 5% jitter
    })

    it('should not cache when negativeTtlSeconds is 0', async () => {
      const zeroCacheNeg = new ResilientCache(redis, {
        prefix: 'test:',
        defaultTtlSeconds: 60,
        negativeTtlSeconds: 0, // Don't cache failures
        maxPendingFetches: 10,
        fetchTimeoutMs: 2000,
        ttlJitterPercentage: 0,
      })

      const key = 'test:zero-negative-ttl'
      const errorMapper = (error: unknown) => {
        if (error instanceof Error) {
          return { type: 'TestError', message: error.message }
        }
        return null
      }

      await expect(
        zeroCacheNeg.getOrFetch(
          key,
          async () => {
            throw new Error('Test')
          },
          errorMapper,
        ),
      ).rejects.toThrow(CachedFailureError)

      // Should not be in cache
      const cached = await redis.get(key)
      expect(cached).toBeNull()
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
// ============================================================================
