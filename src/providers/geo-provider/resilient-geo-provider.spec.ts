// src/providers/geo-provider/resilient-geo-provider.spec.ts

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
    mockGenerateKey: vi.fn().mockReturnValue('mock-geo-key'),
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
import { ResilientGeoProvider } from './resilient-geo-provider'
import { GeocodingProvider, GeoCoordinates, GeoPrecision, GeoSearchOptions } from './geo-provider.interface'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'
import { CachedFailureError } from '@lib/redis/helper/resilient-cache'

// Helper: Objeto mockado estritamente tipado conforme GeoCoordinates
const mockCoords: GeoCoordinates = {
  lat: -23.55052,
  lon: -46.633308,
  precision: GeoPrecision.ROOFTOP,
  providerName: 'MockProvider',
}

const mockSearchOptions: GeoSearchOptions = {
  street: 'Av Paulista',
  city: 'São Paulo',
  state: 'SP',
  country: 'BR',
}

describe('ResilientGeoProvider Unit Tests', () => {
  let redisClient: Redis
  let provider1: GeocodingProvider
  let provider2: GeocodingProvider

  beforeEach(() => {
    vi.clearAllMocks()
    redisClient = new Redis()

    // Mocks dos providers tipados como GeocodingProvider
    provider1 = { search: vi.fn(), searchStructured: vi.fn() }
    provider2 = { search: vi.fn(), searchStructured: vi.fn() }

    // Mock padrão do getOrFetch para simular Cache Miss (executa o fetcher real)
    mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => {
      const effectiveSignal = signal || new AbortController().signal
      return fetcher(effectiveSignal)
    })
  })

  const createProvider = (providers = [provider1, provider2]) => {
    return new ResilientGeoProvider(providers, redisClient, {
      prefix: 'geo-test:',
      defaultTtlSeconds: 60,
      negativeTtlSeconds: 10,
    } as any)
  }

  describe('Constructor', () => {
    it('should throw NoGeoProviderError if providers list is empty', () => {
      expect(() => createProvider([])).toThrow(NoGeoProviderError)
    })

    it('should initialize successfully with valid providers', () => {
      const provider = createProvider()
      expect(provider).toBeInstanceOf(ResilientGeoProvider)
    })
  })

  describe('search - Cache Logic', () => {
    it('should return coordinates from CACHE HIT without calling providers', async () => {
      const provider = createProvider()

      // Simula Cache Hit (retorna valor GeoCoordinates direto)
      mockGetOrFetch.mockResolvedValue(mockCoords)

      const result = await provider.search('Av Paulista')

      expect(result).toEqual(mockCoords)
      expect(mockGetOrFetch).toHaveBeenCalled()
      expect(provider1.search).not.toHaveBeenCalled()
    })

    it('should re-throw CoordinatesNotFoundError from CACHE HIT (Cached Failure)', async () => {
      const provider = createProvider()

      const cachedError = new CachedFailureError('CoordinatesNotFoundError', 'Não encontrado')
      mockGetOrFetch.mockRejectedValue(cachedError)

      await expect(provider.search('Rua Inexistente')).rejects.toThrow(CoordinatesNotFoundError)
    })

    it('should throw GeoProviderFailureError on CACHE HIT with unexpected error type', async () => {
      const provider = createProvider()

      const cachedError = new CachedFailureError('UnknownError', 'Algo estranho')
      mockGetOrFetch.mockRejectedValue(cachedError)

      await expect(provider.search('Query')).rejects.toThrow(GeoProviderFailureError)
    })

    it('should execute fetch strategy on CACHE MISS', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Av Paulista')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalled()
    })
  })

  describe('searchStructured - Cache Logic', () => {
    it('should return coordinates from CACHE HIT', async () => {
      const provider = createProvider()
      mockGetOrFetch.mockResolvedValue(mockCoords)

      const result = await provider.searchStructured(mockSearchOptions)

      expect(result).toEqual(mockCoords)
      expect(provider1.searchStructured).not.toHaveBeenCalled()
    })

    it('should execute fetch strategy on CACHE MISS', async () => {
      const provider = createProvider()
      vi.spyOn(provider1, 'searchStructured').mockResolvedValue(mockCoords)

      const result = await provider.searchStructured(mockSearchOptions)

      expect(result).toEqual(mockCoords)
      expect(provider1.searchStructured).toHaveBeenCalledWith(mockSearchOptions, expect.anything())
    })
  })

  describe('executeStrategy (Provider Logic)', () => {
    // Testes usando 'search' como proxy para testar o executeStrategy
    it('should return result immediately if first provider succeeds', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Query')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalled()
      expect(provider2.search).not.toHaveBeenCalled()
    })

    it('should fallback to second provider if first returns NULL (not found)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(null)
      vi.spyOn(provider2, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Query')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalled()
      expect(provider2.search).toHaveBeenCalled()
    })

    it('should fallback to second provider if first throws CoordinatesNotFoundError', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockRejectedValue(new CoordinatesNotFoundError())
      vi.spyOn(provider2, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Query')

      expect(result).toEqual(mockCoords)
      expect(provider2.search).toHaveBeenCalled()
    })

    it('should fallback to second provider if first fails with System Error (Busy/Generic)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Query')

      expect(result).toEqual(mockCoords)
      expect(provider2.search).toHaveBeenCalled()
    })

    it('should fallback to second provider if first returns 404 status object', async () => {
      const provider = createProvider()
      // Simula erro de axios ou similar
      vi.spyOn(provider1, 'search').mockRejectedValue({ status: 404, message: 'Not Found' })
      vi.spyOn(provider2, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Query')

      expect(result).toEqual(mockCoords)
    })

    it('should throw CoordinatesNotFoundError if ALL providers return not found (null/CoordinatesNotFoundError/404)', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(null)
      vi.spyOn(provider2, 'search').mockRejectedValue(new CoordinatesNotFoundError())

      await expect(provider.search('Nowhere')).rejects.toThrow(CoordinatesNotFoundError)
    })

    it('should throw GeoServiceBusyError if the last provider had a ServiceBusy error', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockRejectedValue(new Error('Connection timeout'))
      vi.spyOn(provider2, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider2'))

      await expect(provider.search('Query')).rejects.toThrow(GeoServiceBusyError)
    })

    it('should throw GeoProviderFailureError if the last provider had a non-busy System Error', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'search').mockRejectedValue(new Error('Connection timeout'))

      await expect(provider.search('Query')).rejects.toThrow(GeoProviderFailureError)
    })

    it('should throw GeoServiceBusyError if ANY provider had a System Error and last was ServiceBusy, even if others said Not Found', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(null)
      vi.spyOn(provider2, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider2'))

      await expect(provider.search('Query')).rejects.toThrow(GeoServiceBusyError)
    })

    it('should throw GeoProviderFailureError if ANY provider had a non-busy System Error and last was not ServiceBusy, even if others said Not Found', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(null)
      vi.spyOn(provider2, 'search').mockRejectedValue(new Error('Network error'))

      await expect(provider.search('Query')).rejects.toThrow(GeoProviderFailureError)
    })

    it('should throw GeoServiceBusyError if ALL providers have ServiceBusy errors', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider2'))

      await expect(provider.search('Query')).rejects.toThrow(GeoServiceBusyError)
    })

    it('should throw GeoProviderFailureError with wrapped error when last error is generic system error', async () => {
      const provider = createProvider()
      const systemError = new Error('Database connection failed')

      vi.spyOn(provider1, 'search').mockRejectedValue(new GeoServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'search').mockRejectedValue(systemError)

      await expect(provider.search('Query')).rejects.toThrow(GeoProviderFailureError)
    })

    it('should stop immediately and throw TimeoutExceededOnFetchError if signal is aborted', async () => {
      const provider = createProvider()
      const controller = new AbortController()
      controller.abort(new Error('Timeout'))

      mockGetOrFetch.mockImplementation(async (key, fetcher, mapper, signal) => {
        // Passamos o signal cancelado para o fetcher
        return fetcher(signal)
      })

      await expect(provider.search('Query', controller.signal)).rejects.toThrow(TimeoutExceededOnFetchError)

      expect(provider1.search).not.toHaveBeenCalled()
    })
  })

  describe('Error Mapper Logic', () => {
    it('should map CoordinatesNotFoundError to cacheable object', async () => {
      const provider = createProvider()
      let interceptedMapper: any

      // Intercepta o errorMapper passado para o cache
      mockGetOrFetch.mockImplementation(async (key, fetcher, errorMapper) => {
        interceptedMapper = errorMapper
        return null // Simula execução sem retorno para permitir teste do mapper
      })

      await provider.search('Query')

      expect(interceptedMapper).toBeDefined()

      const error = new CoordinatesNotFoundError()
      const mapped = interceptedMapper(error)

      expect(mapped).toEqual({
        type: 'CoordinatesNotFoundError',
        message: expect.any(String),
        data: { query: 'Query' },
      })
    })

    it('should return NULL for system errors (preventing cache)', async () => {
      const provider = createProvider()
      let interceptedMapper: any

      mockGetOrFetch.mockImplementation(async (key, fetcher, errorMapper) => {
        interceptedMapper = errorMapper
        return null
      })

      await provider.search('Query')

      const error = new Error('System Crash')
      const mapped = interceptedMapper(error)

      expect(mapped).toBeNull()
    })
  })
})
