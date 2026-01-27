// Mock environment variables FIRST
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest'

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

import { ResilientAddressProvider } from './resilient-address-provider'
import { AddressProvider, AddressData } from './address-provider.interface'
import { Redis } from 'ioredis'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
// Import classes for type checking, implementation is mocked below
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
  prefix: 'address',
  defaultTtlSeconds: 60,
  negativeTtlSeconds: 30,
  maxPendingFetches: 1,
  fetchTimeoutMs: 1000,
  ttlJitterPercentage: 0,
}

// Helper to create mock providers
const createMockProvider = (name: string): AddressProvider =>
  ({
    fetchAddress: vi.fn(),
    constructor: { name },
  }) as any

describe('ResilientAddressProvider', () => {
  let provider1: AddressProvider
  let provider2: AddressProvider
  let resilientProvider: ResilientAddressProvider

  const mockAddress: AddressData = {
    localidade: 'Sao Paulo',
    uf: 'SP',
    logradouro: 'Av Paulista',
    bairro: 'Bela Vista',
  }

  const rawCep = '01311-200'
  const cleanCep = '01311200'

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
    it('should throw NoAddressProviderError if provider list is empty', () => {
      expect(() => {
        new ResilientAddressProvider([], mockRedis, defaultCacheOptions)
      }).toThrow(NoAddressProviderError)
    })

    it('should instantiate correctly with valid providers', () => {
      const instance = new ResilientAddressProvider([provider1], mockRedis, defaultCacheOptions)
      expect(instance).toBeInstanceOf(ResilientAddressProvider)
    })
  })

  describe('fetchAddress() Strategy', () => {
    it('should return address from the first provider if successful', async () => {
      ;(provider1.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
      // Verify CEP was cleaned before passing to provider
      expect(provider1.fetchAddress).toHaveBeenCalledWith(cleanCep, expect.anything())
      expect(provider2.fetchAddress).not.toHaveBeenCalled()
    })

    it('should failover to second provider if first returns null (soft failure)', async () => {
      ;(provider1.fetchAddress as Mock).mockResolvedValue(null)
      ;(provider2.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
      expect(provider1.fetchAddress).toHaveBeenCalled()
      expect(provider2.fetchAddress).toHaveBeenCalled()
    })

    it('should failover to second provider if first throws system error', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new Error('Network Error'))
      ;(provider2.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
      expect(provider2.fetchAddress).toHaveBeenCalled()
    })

    it('should failover if first provider throws AddressServiceBusyError', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new AddressServiceBusyError('ViaCEP'))
      ;(provider2.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
    })

    it('should failover if first provider throws InvalidCepError (Business Error treated as Not Found for individual providers)', async () => {
      // If one provider says invalid, we still try others just in case one database is outdated
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new InvalidCepError())
      ;(provider2.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
    })

    it('should failover if first provider returns 404 object (axios style error)', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue({ status: 404 })
      ;(provider2.fetchAddress as Mock).mockResolvedValue(mockAddress)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
    })

    it('should throw InvalidCepError if ALL providers agree CEP does not exist (InvalidCepError/404/Null)', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new InvalidCepError())
      ;(provider2.fetchAddress as Mock).mockResolvedValue(null)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow(InvalidCepError)
    })

    it('should throw system error (last error) if all fail with system errors', async () => {
      const error1 = new Error('Timeout')
      const error2 = new Error('API Down')
      ;(provider1.fetchAddress as Mock).mockRejectedValue(error1)
      ;(provider2.fetchAddress as Mock).mockRejectedValue(error2)
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow('API Down')
    })

    it('should prioritize system error over not-found error if mixed results occur', async () => {
      // Logic: If we have at least one system error, we throw that instead of InvalidCep
      // to avoid caching a "Not Found" when it might just be a service outage.
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new InvalidCepError())
      ;(provider2.fetchAddress as Mock).mockRejectedValue(new Error('System Crash'))

      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow('System Crash')
    })
  })

  describe('Caching Behavior', () => {
    beforeEach(() => {
      resilientProvider = new ResilientAddressProvider([provider1], mockRedis, defaultCacheOptions)
    })

    it('should return cached result if available (Cache Hit)', async () => {
      // Mock Cache HIT
      mockGetOrFetch.mockResolvedValue(mockAddress)

      const result = await resilientProvider.fetchAddress(rawCep)

      expect(result).toEqual(mockAddress)
      expect(provider1.fetchAddress).not.toHaveBeenCalled()
    })

    it('should cache "InvalidCepError" (Business Error Caching)', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new InvalidCepError())

      // 1. Cache Miss (Calls fetcher)
      mockGetOrFetch.mockImplementationOnce(async (key, fetcher) => fetcher(new AbortController().signal))

      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow(InvalidCepError)
      expect(provider1.fetchAddress).toHaveBeenCalledTimes(1)

      // 2. Cache Hit (Throws cached error)
      // The cache manager translates the stored error JSON back to CachedFailureError
      mockGetOrFetch.mockRejectedValue(new CachedFailureError('InvalidCepError', 'Invalid CEP'))

      // The provider catches CachedFailureError and re-throws the domain InvalidCepError
      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow(InvalidCepError)
      expect(provider1.fetchAddress).toHaveBeenCalledTimes(1) // Still 1
    })

    it('should NOT cache system errors', async () => {
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new Error('System Crash'))
      await expect(resilientProvider.fetchAddress('12345678')).rejects.toThrow('System Crash')
    })

    it('should handle CachedFailureError with unexpected type by logging and throwing AddressProviderFailureError', async () => {
      mockGetOrFetch.mockRejectedValue(new CachedFailureError('UnknownErrorType', '???'))
      await expect(resilientProvider.fetchAddress(rawCep)).rejects.toThrow(AddressProviderFailureError)
    })
  })

  describe('Cancellation (AbortSignal)', () => {
    it('should propagate abort signal to providers', async () => {
      const abortController = new AbortController()
      resilientProvider = new ResilientAddressProvider([provider1], mockRedis, defaultCacheOptions)

      // Pass signal through mock cache
      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => fetcher(signal))

      // Delay to catch abort in flight
      ;(provider1.fetchAddress as Mock).mockImplementation(async (cep, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        if (signal.aborted) throw signal.reason
        return mockAddress
      })

      const promise = resilientProvider.fetchAddress(rawCep, abortController.signal)
      abortController.abort()

      await expect(promise).rejects.toThrow()
    })

    it('should stop failover loop if signal is aborted', async () => {
      const abortController = new AbortController()
      resilientProvider = new ResilientAddressProvider([provider1, provider2], mockRedis, defaultCacheOptions)

      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => fetcher(signal))
      ;(provider1.fetchAddress as Mock).mockRejectedValue(new Error('Fail 1'))

      abortController.abort()

      await expect(resilientProvider.fetchAddress(rawCep, abortController.signal)).rejects.toBeTruthy()
      expect(provider2.fetchAddress).not.toHaveBeenCalled()
    })
  })
})
