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
import { ResilientAddressProvider } from './resilient-address-provider'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/errors/infra/cache/timeout-exceed-on-fetch-error'
import { IAddressData, IAddressProvider } from 'core/contracts/use-cases/providers/address-provider.interface'

// Helper: Objeto mockado estritamente tipado conforme AddressData
const mockAddress: IAddressData = {
  logradouro: 'Rua Teste',
  bairro: 'Bairro Teste',
  localidade: 'Cidade Teste',
  uf: 'TS',
}

describe('ResilientAddressProvider Unit Tests', () => {
  let provider1: IAddressProvider
  let provider2: IAddressProvider

  beforeEach(() => {
    vi.clearAllMocks()

    // Mocks dos providers tipados como AddressProvider
    provider1 = { fetchAddress: vi.fn() }
    provider2 = { fetchAddress: vi.fn() }

  })

  const createProvider = (providers = [provider1, provider2]) => {
    return new ResilientAddressProvider(providers)
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

    it('should throw AddressServiceBusyError if the last provider had a ServiceBusy error', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new Error('Connection timeout'))
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider2'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressServiceBusyError)
    })

    it('should throw AddressProviderFailureError if the last provider had a non-busy System Error', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new Error('Connection timeout'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should throw AddressServiceBusyError if ANY provider had a System Error and last was ServiceBusy, even if others said Not Found', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(null)
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider2'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressServiceBusyError)
    })

    it('should throw AddressProviderFailureError if ANY provider had a non-busy System Error and last was not ServiceBusy, even if others said Not Found', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockResolvedValue(null)
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new Error('Network error'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should throw AddressServiceBusyError if ALL providers have ServiceBusy errors', async () => {
      const provider = createProvider()

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider2'))

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressServiceBusyError)
    })

    it('should throw AddressProviderFailureError with wrapped error when last error is generic system error', async () => {
      const provider = createProvider()
      const systemError = new Error('Database connection failed')

      vi.spyOn(provider1, 'fetchAddress').mockRejectedValue(new AddressServiceBusyError('MockProvider1'))
      vi.spyOn(provider2, 'fetchAddress').mockRejectedValue(systemError)

      await expect(provider.fetchAddress('12345678')).rejects.toThrow(AddressProviderFailureError)
    })

    it('should stop immediately and throw TimeoutExceededOnFetchError if signal is aborted', async () => {
      const provider = createProvider()
      const controller = new AbortController()
      controller.abort(new Error('Timeout'))

      await expect(provider.fetchAddress('12345678', controller.signal)).rejects.toThrow(TimeoutExceededOnFetchError)

      expect(provider1.fetchAddress).not.toHaveBeenCalled()
    })
  })
})
