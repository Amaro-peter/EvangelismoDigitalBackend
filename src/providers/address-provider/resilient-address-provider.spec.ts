import { vi, describe, it, expect, beforeEach } from 'vitest'

// 1. Mocks de Ambiente e Logger
vi.mock('@lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
  },
}))

vi.mock('@lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// 2. Mock do IORedis
vi.mock('ioredis', () => {
  return {
    default: vi.fn(),
    Redis: vi.fn(),
  }
})

// 3. Mock do ResilientCache e CachedFailureError
// Usamos vi.hoisted para variáveis acessíveis dentro e fora do mock
const { mockGetOrFetch, mockGenerateKey } = vi.hoisted(() => {
  return {
    mockGetOrFetch: vi.fn(),
    mockGenerateKey: vi.fn().mockReturnValue('mock-key'),
  }
})

vi.mock('@lib/redis/helper/resilient-cache', () => {
  class MockCachedFailureError extends Error {
    public errorType: string
    public errorData?: any

    constructor(type: string, message: string, data?: any) {
      super(message)
      this.name = 'CachedFailureError'
      this.errorType = type
      this.errorData = data
    }
  }

  return {
    // Usamos function() tradicional para permitir 'new ResilientCache()'
    ResilientCache: vi.fn().mockImplementation(function () {
      return {
        getOrFetch: mockGetOrFetch,
        generateKey: mockGenerateKey,
      }
    }),
    CachedFailureError: MockCachedFailureError,
  }
})

// Imports reais
import Redis from 'ioredis'
import { ResilientAddressProvider } from './resilient-address-provider'
import { AddressProvider, AddressData } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'
import { CachedFailureError } from '@lib/redis/helper/resilient-cache'

// Helper: Objeto mockado estritamente tipado conforme AddressData
const mockAddress: AddressData = {
  logradouro: 'Rua Teste',
  bairro: 'Bairro Teste',
  localidade: 'Cidade Teste',
  uf: 'TS',
}

describe('ResilientAddressProvider Unit Tests', () => {
  let redisClient: Redis
  let provider1: AddressProvider
  let provider2: AddressProvider

  beforeEach(() => {
    vi.clearAllMocks()
    redisClient = new Redis()

    // Mocks dos providers tipados como AddressProvider
    provider1 = { fetchAddress: vi.fn() }
    provider2 = { fetchAddress: vi.fn() }

    // Mock padrão do getOrFetch para simular Cache Miss (executa o fetcher real)
    // CORREÇÃO: Garante que um AbortSignal seja passado, mesmo que undefined no teste
    mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => {
      const effectiveSignal = signal || new AbortController().signal
      return fetcher(effectiveSignal)
    })
  })

  const createProvider = (providers = [provider1, provider2]) => {
    return new ResilientAddressProvider(providers, redisClient, {
      prefix: 'test:',
      defaultTtlSeconds: 60,
      negativeTtlSeconds: 10,
    } as any)
  }

  describe('Constructor', () => {
    it('should throw NoAddressProviderError if providers list is empty', () => {
      expect(() => createProvider([])).toThrow(NoAddressProviderError)
    })

    it('should initialize successfully with valid providers', () => {
      const provider = createProvider()
      expect(provider).toBeInstanceOf(ResilientAddressProvider)
    })
  })

  describe('fetchAddress - Cache Logic', () => {
    it('should return address from CACHE HIT without calling providers', async () => {
      const provider = createProvider()

      // Simula Cache Hit (retorna valor AddressData direto)
      mockGetOrFetch.mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(mockGetOrFetch).toHaveBeenCalled()
      expect(provider1.fetchAddress).not.toHaveBeenCalled()
    })

    it('should re-throw InvalidCepError from CACHE HIT (Cached Failure)', async () => {
      const provider = createProvider()

      const cachedError = new CachedFailureError('InvalidCepError', 'CEP inválido')
      mockGetOrFetch.mockRejectedValue(cachedError)

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(InvalidCepError)
    })

    it('should throw AddressProviderFailureError on CACHE HIT with unexpected error type', async () => {
      const provider = createProvider()

      const cachedError = new CachedFailureError('UnknownError', 'Algo estranho')
      mockGetOrFetch.mockRejectedValue(cachedError)

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should execute fetch strategy on CACHE MISS', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(provider1.fetchAddress).toHaveBeenCalled()
    })
  })

  describe('executeStrategy (Provider Logic)', () => {
    it('should return result immediately if first provider succeeds', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(provider1.fetchAddress).toHaveBeenCalled()
      expect(provider2.fetchAddress).not.toHaveBeenCalled()
    })

    it('should fallback to second provider if first returns NULL (not found)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(null)
      vi.spyOn(provider2, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(provider1.fetchAddress).toHaveBeenCalled()
      expect(provider2.fetchAddress).toHaveBeenCalled()
    })

    it('should fallback to second provider if first throws InvalidCepError', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new InvalidCepError())
      vi.spyOn(provider2, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(provider2.fetchAddress).toHaveBeenCalled()
    })

    it('should fallback to second provider if first fails with System Error (Busy/Generic)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
      expect(provider2.fetchAddress).toHaveBeenCalled()
    })

    it('should fallback to second provider if first returns 404 status object', async () => {
      const provider = createProvider()
      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue({ status: 404, message: 'Not Found' })
      vi.spyOn(provider2, 'fetchAddress').mockResolvedValue(mockAddress)

      const result = await provider.fetchAddress('12345678')

      expect(result).toEqual(mockAddress)
    })

    it('should throw InvalidCepError if ALL providers return not found (null/InvalidCep/404)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(null)
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new InvalidCepError())

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(InvalidCepError)
    })

    it('should throw AddressProviderFailureError if ANY provider had a System Error, even if others said Not Found', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'fetchAddress').mockResolvedValue(null)

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should throw AddressProviderFailureError if ALL providers have System Errors', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new Error('Connection timeout'))
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider2'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should stop immediately and throw TimeoutExceededOnFetchError if signal is aborted', async () => {
      const provider = createProvider()
      const controller = new AbortController()
      controller.abort(new Error('Timeout'))

      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => {
        // Neste caso específico, queremos testar o repasse do sinal abortado
        return fetcher(signal)
      })

      await expect(provider.fetchAddress('12345678', controller.signal)).rejects.toThrow(TimeoutExceededOnFetchError)

      expect(provider1.fetchAddress).not.toHaveBeenCalled()
    })
  })

  describe('Error Mapper Logic', () => {
    it('should map InvalidCepError to cacheable object', async () => {
      const provider = createProvider()
      let interceptedMapper: any

      mockGetOrFetch.mockImplementation(async (key, fetcher, errorMapper) => {
        interceptedMapper = errorMapper
        return null
      })

      await provider.fetchAddress('12345678')

      expect(interceptedMapper).toBeDefined()

      const error = new InvalidCepError()
      const mapped = interceptedMapper(error)

      expect(mapped).toEqual({
        type: 'InvalidCepError',
        message: expect.any(String),
        data: { cep: '12345678' },
      })
    })

    it('should return NULL for system errors (preventing cache)', async () => {
      const provider = createProvider()
      let interceptedMapper: any

      mockGetOrFetch.mockImplementation(async (key, fetcher, errorMapper) => {
        interceptedMapper = errorMapper
        return null
      })

      await provider.fetchAddress('12345678')

      const error = new Error('System Crash')
      const mapped = interceptedMapper(error)

      expect(mapped).toBeNull()
    })
  })
})
