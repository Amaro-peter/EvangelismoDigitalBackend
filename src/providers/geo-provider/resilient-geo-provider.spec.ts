// Mock environment variables FIRST
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'

vi.mock('@lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
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

import { ResilientGeoProvider } from './resilient-geo-provider'
import { GeocodingProvider, GeoCoordinates, GeoPrecision, GeoSearchOptions } from './geo-provider.interface'
import { Redis } from 'ioredis'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { CachedFailureError } from '@lib/redis/helper/resilient-cache'

// Mock dependencies
vi.mock('ioredis')
vi.mock('@lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// --- MOCK RESILIENT CACHE ---
const mockGetOrFetch = vi.fn()

vi.mock('@lib/redis/helper/resilient-cache', () => {
  return {
    // FIX: Use a regular 'function' here so it can be called with 'new'
    ResilientCache: vi.fn().mockImplementation(function () {
      return {
        generateKey: vi.fn((obj) => JSON.stringify(obj)),
        getOrFetch: mockGetOrFetch,
      }
    }),
    CachedFailureError: class CachedFailureError extends Error {
      constructor(
        public errorType: string,
        message: string,
      ) {
        super(message)
      }
    },
  }
})

// Mock Redis (still needed for the Type signature)
const mockRedis = {} as unknown as Redis

const defaultCacheOptions = {
  prefix: 'geo',
  defaultTtlSeconds: 60,
  negativeTtlSeconds: 30,
  maxPendingFetches: 1,
  fetchTimeoutMs: 1000,
  ttlJitterPercentage: 0,
}

// Helper to create mock providers
const createMockProvider = (name: string): GeocodingProvider =>
  ({
    search: vi.fn(),
    searchStructured: vi.fn(),
    constructor: { name },
  }) as any

describe('ResilientGeoProvider', () => {
  let provider1: GeocodingProvider
  let provider2: GeocodingProvider
  let resilientProvider: ResilientGeoProvider

  const mockCoords: GeoCoordinates = {
    lat: -23.55052,
    lon: -46.633308,
    precision: GeoPrecision.ROOFTOP,
  }

  const mockSearchOptions: GeoSearchOptions = {
    street: 'Av Paulista',
    city: 'Sao Paulo',
    state: 'SP',
    country: 'BR',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    provider1 = createMockProvider('Provider1')
    provider2 = createMockProvider('Provider2')

    // Default behavior: Execute the fetcher (Cache Miss simulation)
    mockGetOrFetch.mockImplementation(async (key, fetcher) => {
      const signal = new AbortController().signal
      return fetcher(signal)
    })
  })

  describe('Constructor', () => {
    it('should throw NoGeoProviderError if provider list is empty', () => {
      expect(() => {
        new ResilientGeoProvider([], mockRedis, defaultCacheOptions)
      }).toThrow(NoGeoProviderError)
    })

    it('should instantiate correctly with valid providers', () => {
      const instance = new ResilientGeoProvider([provider1], mockRedis, defaultCacheOptions)
      expect(instance).toBeInstanceOf(ResilientGeoProvider)
    })
  })

  describe('search()', () => {
    it('should return coordinates from the first provider if successful', async () => {
      ;(provider1.search as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.search('test query')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalledWith('test query', expect.anything())
      expect(provider2.search).not.toHaveBeenCalled()
    })

    it('should failover to second provider if first returns null (soft failure)', async () => {
      ;(provider1.search as Mock).mockResolvedValue(null)
      ;(provider2.search as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.search('test query')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalled()
      expect(provider2.search).toHaveBeenCalled()
    })

    it('should failover to second provider if first throws system error', async () => {
      ;(provider1.search as Mock).mockRejectedValue(new Error('Network Error'))
      ;(provider2.search as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.search('test query')

      expect(result).toEqual(mockCoords)
      expect(provider2.search).toHaveBeenCalled()
    })

    it('should failover if first provider throws GeoServiceBusyError', async () => {
      ;(provider1.search as Mock).mockRejectedValue(new GeoServiceBusyError('Awesome API'))
      ;(provider2.search as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.search('test query')

      expect(result).toEqual(mockCoords)
    })

    it('should throw CoordinatesNotFoundError if ALL providers return null', async () => {
      ;(provider1.search as Mock).mockResolvedValue(null)
      ;(provider2.search as Mock).mockResolvedValue(null)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.search('unknown place')).rejects.toThrow(CoordinatesNotFoundError)
    })

    it('should throw CoordinatesNotFoundError if ALL providers return CoordinatesNotFoundError or 404', async () => {
      ;(provider1.search as Mock).mockRejectedValue(new CoordinatesNotFoundError())
      ;(provider2.search as Mock).mockRejectedValue({ status: 404 })
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.search('unknown place')).rejects.toThrow(CoordinatesNotFoundError)
    })

    it('should throw system error (last error) if all fail with system errors', async () => {
      const error1 = new Error('Timeout')
      const error2 = new Error('API Down')
      ;(provider1.search as Mock).mockRejectedValue(error1)
      ;(provider2.search as Mock).mockRejectedValue(error2)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.search('query')).rejects.toThrow('API Down')
    })
  })

  describe('searchStructured()', () => {
    it('should return coordinates from the first provider if successful', async () => {
      ;(provider1.searchStructured as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.searchStructured(mockSearchOptions)

      expect(result).toEqual(mockCoords)
      expect(provider1.searchStructured).toHaveBeenCalledWith(mockSearchOptions, expect.anything())
    })

    it('should failover correctly in structured search', async () => {
      ;(provider1.searchStructured as Mock).mockRejectedValue(new Error('Fail'))
      ;(provider2.searchStructured as Mock).mockResolvedValue(mockCoords)
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.searchStructured(mockSearchOptions)

      expect(result).toEqual(mockCoords)
    })
  })

  describe('Caching Behavior', () => {
    beforeEach(() => {
      resilientProvider = new ResilientGeoProvider([provider1], mockRedis, defaultCacheOptions)
    })

    it('should return cached result if available (Cache Hit)', async () => {
      // Mock Cache HIT
      mockGetOrFetch.mockResolvedValue(mockCoords)

      const result = await resilientProvider.search('cached query')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).not.toHaveBeenCalled()
    })

    it('should cache "CoordinatesNotFoundError" (Business Error Caching)', async () => {
      ;(provider1.search as Mock).mockRejectedValue(new CoordinatesNotFoundError())

      // 1. Cache Miss (Calls fetcher)
      mockGetOrFetch.mockImplementationOnce(async (key, fetcher) => fetcher(new AbortController().signal))

      await expect(resilientProvider.search('nowhere')).rejects.toThrow(CoordinatesNotFoundError)
      expect(provider1.search).toHaveBeenCalledTimes(1)

      // 2. Cache Hit (Throws cached error)
      mockGetOrFetch.mockRejectedValue(new CachedFailureError('CoordinatesNotFoundError', 'Not found'))

      await expect(resilientProvider.search('nowhere')).rejects.toThrow(CoordinatesNotFoundError)
      expect(provider1.search).toHaveBeenCalledTimes(1)
    })

    it('should NOT cache system errors', async () => {
      ;(provider1.search as Mock).mockRejectedValue(new Error('System Crash'))
      await expect(resilientProvider.search('crash')).rejects.toThrow('System Crash')
    })

    it('should handle CachedFailureError with unexpected type by logging and throwing GeoProviderFailureError', async () => {
      mockGetOrFetch.mockRejectedValue(new CachedFailureError('UnknownErrorType', '???'))
      await expect(resilientProvider.search('query')).rejects.toThrow(GeoProviderFailureError)
    })
  })

  describe('Cancellation (AbortSignal)', () => {
    it('should propagate abort signal to providers', async () => {
      const abortController = new AbortController()
      resilientProvider = new ResilientGeoProvider([provider1], mockRedis, defaultCacheOptions)

      // Pass signal through mock cache
      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => fetcher(signal))

      // FIX: Add small delay to ensure the abort happens while request is "in flight"
      ;(provider1.search as Mock).mockImplementation(async (q, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 20)) // Tiny delay
        if (signal.aborted) throw signal.reason
        return mockCoords
      })

      const promise = resilientProvider.search('query', abortController.signal)
      abortController.abort()

      await expect(promise).rejects.toThrow()
    })

    it('should stop failover loop if signal is aborted', async () => {
      const abortController = new AbortController()
      resilientProvider = new ResilientGeoProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => fetcher(signal))
      ;(provider1.search as Mock).mockRejectedValue(new Error('Fail 1'))

      abortController.abort()

      await expect(resilientProvider.search('query', abortController.signal)).rejects.toBeTruthy()
      expect(provider2.search).not.toHaveBeenCalled()
    })
  })
})
