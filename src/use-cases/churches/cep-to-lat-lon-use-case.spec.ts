import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CepToLatLonUseCase } from './cep-to-lat-lon-use-case'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import axios from 'axios'

vi.mock('axios')

describe('CepToLatLon Use Case', () => {
  const mockedAxios = vi.mocked(axios, true)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should convert a valid CEP to latitude and longitude', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        logradouro: 'Avenida Paulista',
        localidade: 'São Paulo',
        uf: 'SP',
      },
    })

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          lat: '-23.5631',
          lon: '-46.6554',
        },
      ],
    })

    const { userLat, userLon } = await useCase.execute({ cep: '01310-100' })

    expect(userLat).toBe(-23.5631)
    expect(userLon).toBe(-46.6554)
    expect(mockedAxios.get).toHaveBeenCalledTimes(2)
    expect(mockedAxios.get).toHaveBeenCalledWith('https://viacep.com.br/ws/01310-100/json/')
  })

  it('should throw InvalidCepError when CEP is invalid', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        erro: true,
      },
    })

    await expect(() => useCase.execute({ cep: '00000-000' })).rejects.toBeInstanceOf(InvalidCepError)
  })

  it('should throw CoordinatesNotFoundError when no coordinates are found', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        logradouro: 'Rua Inexistente',
        localidade: 'Cidade Desconhecida',
        uf: 'XX',
      },
    })

    mockedAxios.get.mockResolvedValueOnce({
      data: [],
    })

    await expect(() => useCase.execute({ cep: '12345-678' })).rejects.toBeInstanceOf(CoordinatesNotFoundError)
  })

  it('should throw CoordinatesNotFoundError when geocoding response is null', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        logradouro: 'Rua Teste',
        localidade: 'São Paulo',
        uf: 'SP',
      },
    })

    mockedAxios.get.mockResolvedValueOnce({
      data: null,
    })

    await expect(() => useCase.execute({ cep: '12345-678' })).rejects.toBeInstanceOf(CoordinatesNotFoundError)
  })

  it('should call Nominatim API with correct parameters', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        logradouro: 'Avenida Atlântica',
        localidade: 'Rio de Janeiro',
        uf: 'RJ',
      },
    })

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          lat: '-22.9707',
          lon: '-43.1824',
        },
      ],
    })

    await useCase.execute({ cep: '22010-000' })

    expect(mockedAxios.get).toHaveBeenNthCalledWith(2, 'https://nominatim.openstreetmap.org/search', {
      params: {
        q: 'Avenida Atlântica, Rio de Janeiro - RJ, Brazil',
        format: 'jsonv2',
        limit: 1,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
      },
    })
  })

  it('should parse string latitude and longitude to numbers', async () => {
    const useCase = new CepToLatLonUseCase()

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        logradouro: 'Rua Teste',
        localidade: 'São Paulo',
        uf: 'SP',
      },
    })

    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          lat: '-23.5505',
          lon: '-46.6333',
        },
      ],
    })

    const { userLat, userLon } = await useCase.execute({ cep: '01000-000' })

    expect(typeof userLat).toBe('number')
    expect(typeof userLon).toBe('number')
    expect(userLat).toBe(-23.5505)
    expect(userLon).toBe(-46.6333)
  })
})
