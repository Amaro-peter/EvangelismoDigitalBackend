// src/providers/geo-provider/resilient-geo-provider.spec.ts

import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Imports reais
import { ResilientGeoProvider } from './resilient-geo-provider'
import {
  GeocodingProvider,
  GeoCoordinates,
  GeoPrecision,
  GeoSearchOptions,
} from '../../core/contracts/providers/geo-provider.interface'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/errors/infra/cache/timeout-exceed-on-fetch-error'

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
  let provider1: GeocodingProvider
  let provider2: GeocodingProvider

  beforeEach(() => {
    vi.clearAllMocks()

    // Mocks dos providers tipados como GeocodingProvider
    provider1 = { search: vi.fn(), searchStructured: vi.fn() }
    provider2 = { search: vi.fn(), searchStructured: vi.fn() }

  })

  const createProvider = (providers = [provider1, provider2]) => {
    return new ResilientGeoProvider(providers)
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

  describe('search', () => {
    it('should return coordinates from the first provider', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'search').mockResolvedValue(mockCoords)

      const result = await provider.search('Av Paulista')

      expect(result).toEqual(mockCoords)
      expect(provider1.search).toHaveBeenCalledWith('Av Paulista', expect.any(AbortSignal))
    })
  })

  describe('searchStructured', () => {
    it('should return coordinates from the first provider', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'searchStructured').mockResolvedValue(mockCoords)

      const result = await provider.searchStructured(mockSearchOptions)

      expect(result).toEqual(mockCoords)
      expect(provider1.searchStructured).toHaveBeenCalledWith(mockSearchOptions, expect.any(AbortSignal))
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

      await expect(provider.search('Query', controller.signal)).rejects.toThrow(TimeoutExceededOnFetchError)

      expect(provider1.search).not.toHaveBeenCalled()
    })
  })
})
