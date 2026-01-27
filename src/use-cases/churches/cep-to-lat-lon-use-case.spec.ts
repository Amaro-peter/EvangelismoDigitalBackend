import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { CepToLatLonUseCase } from './cep-to-lat-lon-use-case'
import { AddressProvider } from 'providers/address-provider/address-provider.interface'
import { GeocodingProvider, GeoPrecision, GeoCoordinates } from 'providers/geo-provider/geo-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { CepToLatLonError } from '@use-cases/errors/cep-to-lat-lon-error'
import { Redis } from 'ioredis'
import { CachedFailureError } from '@lib/redis/helper/resilient-cache'

// --- 1. Mocks de Infraestrutura ---
vi.mock('@lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    // ... rest of env config
    APP_NAME: 'Test',
  },
}))

vi.mock('@lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}))

// --- 2. Mock do Redis e ResilientCache ---
vi.mock('ioredis', () => {
  return {
    Redis: vi.fn(),
  }
})

// === CRITICAL FIX: Global Mock Instance Holder ===
// We use this to bridge the gap between the class mock and our test assertions
const mockGetOrFetch = vi.fn()
const mockGenerateKey = vi.fn()

vi.mock('@lib/redis/helper/resilient-cache', () => {
  return {
    // Return a real class so 'new ResilientCache()' works
    ResilientCache: class ResilientCacheMock {
      constructor() {}
      // Delegate calls to the global spy functions
      getOrFetch(...args: any[]) {
        return mockGetOrFetch(...args)
      }
      generateKey(...args: any[]) {
        return mockGenerateKey(...args)
      }
    },
    // We must expose the real or compatible Error class for 'instanceof' checks
    CachedFailureError: class CachedFailureError extends Error {
      errorType: string
      errorData: any
      constructor(type: string, message: string, data: any) {
        super(message)
        this.name = 'CachedFailureError'
        this.errorType = type
        this.errorData = data
      }
    },
  }
})

describe('CepToLatLon Use Case', () => {
  let useCase: CepToLatLonUseCase
  let addressProviderMock: { fetchAddress: Mock }
  let geocodingProviderMock: { search: Mock; searchStructured: Mock }
  let redisMock: Redis

  const defaultOptions = {
    prefix: 'test',
    defaultTtlSeconds: 60,
    negativeTtlSeconds: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset global spies manually since they are outside the beforeEach scope
    mockGetOrFetch.mockReset()
    mockGenerateKey.mockReset()

    // Default Cache Behavior: Cache Miss (run the fetcher)
    mockGetOrFetch.mockImplementation(async (_key, fetcher, _mapper) => {
      return fetcher(new AbortController().signal)
    })

    mockGenerateKey.mockImplementation(({ cep }) => `cep:${cep}`)

    // Setup Providers
    addressProviderMock = { fetchAddress: vi.fn() }
    geocodingProviderMock = { search: vi.fn(), searchStructured: vi.fn() }
    redisMock = new Redis()

    useCase = new CepToLatLonUseCase(
      geocodingProviderMock as unknown as GeocodingProvider,
      addressProviderMock as unknown as AddressProvider,
      redisMock,
      defaultOptions as any,
    )
  })

  // ============================================================================
  // SUCCESS SCENARIOS
  // ============================================================================

  it('should format CEP correctly and use generated cache key', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({
      lat: -23,
      lon: -46,
      precision: GeoPrecision.ROOFTOP,
    })

    await useCase.execute({ cep: '12.345-678' })

    expect(mockGenerateKey).toHaveBeenCalledWith({ cep: '12345678' })
    expect(addressProviderMock.fetchAddress).toHaveBeenCalledWith('12345678', expect.any(AbortSignal))
  })

  it('OPTIMIZATION: should return coordinates directly if AddressProvider returns them', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({
      logradouro: 'Av Paulista',
      lat: -23.56,
      lon: -46.65,
      precision: GeoPrecision.ROOFTOP,
    })

    const result = await useCase.execute({ cep: '01310100' })

    expect(result).toEqual({
      userLat: -23.56,
      userLon: -46.65,
      precision: GeoPrecision.ROOFTOP,
    })
    expect(geocodingProviderMock.search).not.toHaveBeenCalled()
  })

  it('STRATEGY A: should find coordinates using exact address (Street + City)', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({
      logradouro: 'Avenida Paulista',
      localidade: 'São Paulo',
      uf: 'SP',
    })

    geocodingProviderMock.search.mockResolvedValueOnce({
      lat: -23.5631,
      lon: -46.6554,
      precision: GeoPrecision.ROOFTOP,
    })

    const result = await useCase.execute({ cep: '01310100' })

    expect(geocodingProviderMock.search).toHaveBeenCalledWith(
      'Avenida Paulista, São Paulo - SP, Brazil',
      expect.any(AbortSignal),
    )
    expect(result.userLat).toBe(-23.5631)
  })

  it('STRATEGY B: should fallback to neighborhood search if street search fails', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({
      logradouro: 'Rua Desconhecida',
      bairro: 'Bela Vista',
      localidade: 'São Paulo',
      uf: 'SP',
    })

    geocodingProviderMock.search
      .mockResolvedValueOnce(null) // Falha na Rua
      .mockResolvedValueOnce({
        // Sucesso no Bairro
        lat: -23.1,
        lon: -46.2,
        precision: GeoPrecision.NEIGHBORHOOD,
      })

    const result = await useCase.execute({ cep: '01310100' })

    expect(result.precision).toBe(GeoPrecision.NEIGHBORHOOD)
    expect(geocodingProviderMock.search).toHaveBeenCalledTimes(2)
  })

  it('STRATEGY C: should fallback to structured city search if street and neighborhood fail', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({
      logradouro: 'Rua X',
      bairro: 'Bairro Y',
      localidade: 'São Paulo',
      uf: 'SP',
    })

    geocodingProviderMock.search.mockResolvedValue(null) // Falha rua e bairro
    geocodingProviderMock.searchStructured.mockResolvedValueOnce({
      lat: -23.55,
      lon: -46.63,
      precision: GeoPrecision.CITY,
    })

    const result = await useCase.execute({ cep: '01000000' })

    expect(result.precision).toBe(GeoPrecision.CITY)
    expect(geocodingProviderMock.searchStructured).toHaveBeenCalled()
  })

  // ============================================================================
  // CACHE BEHAVIOR TESTS
  // ============================================================================

  it('should return cached value immediately (Cache Hit)', async () => {
    const cachedResponse = { userLat: 1, userLon: 1, precision: GeoPrecision.ROOFTOP }
    mockGetOrFetch.mockResolvedValue(cachedResponse)

    const result = await useCase.execute({ cep: '00000000' })

    expect(result).toBe(cachedResponse)
    expect(addressProviderMock.fetchAddress).not.toHaveBeenCalled()
  })

  it('should unwrap CachedFailureError back to InvalidCepError', async () => {
    const cachedError = new CachedFailureError('InvalidCepError', 'Invalid CEP', { cep: '000' })
    mockGetOrFetch.mockRejectedValue(cachedError)

    await expect(useCase.execute({ cep: '000' })).rejects.toThrow(InvalidCepError)
  })

  it('should unwrap CachedFailureError back to CoordinatesNotFoundError', async () => {
    const cachedError = new CachedFailureError('CoordinatesNotFoundError', 'Not found', { cep: '000' })
    mockGetOrFetch.mockRejectedValue(cachedError)

    await expect(useCase.execute({ cep: '000' })).rejects.toThrow(CoordinatesNotFoundError)
  })

  it('should properly map domain errors to cacheable objects', async () => {
    let capturedMapper: any
    mockGetOrFetch.mockImplementation(async (_k, fetcher, mapper) => {
      capturedMapper = mapper
      return fetcher(new AbortController().signal)
    })

    addressProviderMock.fetchAddress.mockResolvedValue(null) // Gera InvalidCepError

    try {
      await useCase.execute({ cep: '00000000' })
    } catch {
      /* Ignora erro */
    }

    expect(capturedMapper).toBeDefined()

    // Verifica se InvalidCepError retorna objeto de erro (será cacheado)
    expect(capturedMapper(new InvalidCepError())).toEqual({
      type: 'InvalidCepError',
      message: expect.any(String),
      data: expect.any(Object),
    })

    // Verifica se erro genérico retorna null (não será cacheado)
    expect(capturedMapper(new Error('DB Error'))).toBeNull()
  })

  // ============================================================================
  // ERROR HANDLING (NON-CACHED & SYSTEM ERRORS)
  // ============================================================================

  it('should throw InvalidCepError when provider returns null', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue(null)
    await expect(useCase.execute({ cep: '00000000' })).rejects.toThrow(InvalidCepError)
  })

  it('should throw CoordinatesNotFoundError when all strategies fail', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({ localidade: 'Oz', uf: 'WZ' })
    geocodingProviderMock.search.mockResolvedValue(null)
    geocodingProviderMock.searchStructured.mockResolvedValue(null)

    await expect(useCase.execute({ cep: '00000000' })).rejects.toThrow(CoordinatesNotFoundError)
  })

  it('should bubble up GeoServiceBusyError (Rate Limit)', async () => {
    addressProviderMock.fetchAddress.mockResolvedValue({ logradouro: 'Rua A', localidade: 'B', uf: 'C' })
    geocodingProviderMock.search.mockRejectedValue(new GeoServiceBusyError('Nominatim'))

    await expect(useCase.execute({ cep: '00000000' })).rejects.toThrow(GeoServiceBusyError)
  })

  it('should throw generic CepToLatLonError on unexpected system failure', async () => {
    addressProviderMock.fetchAddress.mockRejectedValue(new Error('Unknown Axios Error'))
    await expect(useCase.execute({ cep: '00000000' })).rejects.toThrow(CepToLatLonError)
  })

  it('should throw CepToLatLonError if cache returns null unexpectedly', async () => {
    // Caso raro onde o cache retorna sucesso (s=true) mas sem valor
    mockGetOrFetch.mockResolvedValue(null)
    await expect(useCase.execute({ cep: '00000000' })).rejects.toThrow(CepToLatLonError)
  })
})
