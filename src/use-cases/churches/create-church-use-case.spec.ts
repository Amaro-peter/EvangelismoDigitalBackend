import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CreateChurchUseCase } from './create-church-use-case'
import { InMemoryChurchesRepository } from '@repositories/in-memory/in-memory-chuches-repository'
import { ChurchAlreadyExistsError } from '@use-cases/errors/church-already-exists-error'
import { CreateChurchError } from '@use-cases/errors/create-church-error'
import { Prisma } from '@prisma/client'
import { NoAddressError } from '@use-cases/errors/no-address-error'

describe('Create Church Use Case', () => {
  let churchesRepository: InMemoryChurchesRepository
  let createChurchUseCase: CreateChurchUseCase

  beforeEach(() => {
    churchesRepository = new InMemoryChurchesRepository()
    createChurchUseCase = new CreateChurchUseCase(churchesRepository)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should create a church successfully', async () => {
    const churchData = {
      name: 'Igreja Batista Central',
      address: 'Rua das Flores, 123',
      lat: -23.5505,
      lon: -46.6333,
    }

    const church = await createChurchUseCase.execute(churchData)

    expect(church).toMatchObject({
      name: churchData.name,
      address: churchData.address,
      lat: churchData.lat,
      lon: churchData.lon,
    })
    expect(church.id).toBeDefined()
    expect(church.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(church.createdAt).toBeInstanceOf(Date)
    expect(church.updatedAt).toBeInstanceOf(Date)
    expect(churchesRepository.items).toHaveLength(1)
  })

  it('should throw ChurchAlreadyExistsError when church with same name exists', async () => {
    const churchData = {
      name: 'Igreja Presbiteriana',
      address: 'Avenida Paulista, 1000',
      lat: -23.5631,
      lon: -46.6554,
    }

    await createChurchUseCase.execute(churchData)

    await expect(() => createChurchUseCase.execute(churchData)).rejects.toBeInstanceOf(ChurchAlreadyExistsError)
    expect(churchesRepository.items).toHaveLength(1)
  })

  it('should not allow creating churches with same name but different locations', async () => {
    const church1 = {
      name: 'Igreja Assembleia de Deus',
      address: 'Rua A, 100',
      lat: -23.5505,
      lon: -46.6333,
    }

    const church2 = {
      name: 'Igreja Assembleia de Deus',
      address: 'Rua B, 200',
      lat: -22.9068,
      lon: -43.1729,
    }

    await createChurchUseCase.execute(church1)

    await expect(() => createChurchUseCase.execute(church2)).rejects.toBeInstanceOf(ChurchAlreadyExistsError)
    expect(churchesRepository.items).toHaveLength(1)
  })

  it('should allow creating churches with different names at same location', async () => {
    const church1 = {
      name: 'Igreja Batista',
      address: 'Rua Central, 100',
      lat: -23.5505,
      lon: -46.6333,
    }

    const church2 = {
      name: 'Igreja Metodista',
      address: 'Rua Central, 100',
      lat: -23.5505,
      lon: -46.6333,
    }

    const firstChurch = await createChurchUseCase.execute(church1)
    const secondChurch = await createChurchUseCase.execute(church2)

    expect(firstChurch.name).toBe(church1.name)
    expect(secondChurch.name).toBe(church2.name)
    expect(firstChurch.id).not.toBe(secondChurch.id)
    expect(churchesRepository.items).toHaveLength(2)
  })

  it('should throw CreateChurchError if repository returns null', async () => {
    vi.spyOn(churchesRepository, 'createChurch').mockResolvedValueOnce(null)

    await expect(() =>
      createChurchUseCase.execute({
        name: 'Igreja Teste',
        address: 'Rua Teste, 123',
        lat: -23.5505,
        lon: -46.6333,
      }),
    ).rejects.toBeInstanceOf(CreateChurchError)
  })

  it('should throw ChurchAlreadyExistsError if Prisma error P2002 occurs', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.2.0',
    } as any)

    vi.spyOn(churchesRepository, 'findByName').mockResolvedValueOnce(null)
    vi.spyOn(churchesRepository, 'createChurch').mockRejectedValueOnce(prismaError)

    await expect(() =>
      createChurchUseCase.execute({
        name: 'Igreja Duplicada',
        address: 'Rua Duplicada, 456',
        lat: -23.5505,
        lon: -46.6333,
      }),
    ).rejects.toBeInstanceOf(ChurchAlreadyExistsError)
  })

  it('should throw ChurchAlreadyExistsError if error message is "church-already-exists"', async () => {
    const customError = new Error('church-already-exists')

    vi.spyOn(churchesRepository, 'findByName').mockResolvedValueOnce(null)
    vi.spyOn(churchesRepository, 'createChurch').mockRejectedValueOnce(customError)

    await expect(() =>
      createChurchUseCase.execute({
        name: 'Igreja Teste',
        address: 'Rua Teste, 789',
        lat: -23.5505,
        lon: -46.6333,
      }),
    ).rejects.toBeInstanceOf(ChurchAlreadyExistsError)
  })

  it('should rethrow unexpected errors', async () => {
    const unexpectedError = new Error('Database connection failed')

    vi.spyOn(churchesRepository, 'findByName').mockResolvedValueOnce(null)
    vi.spyOn(churchesRepository, 'createChurch').mockRejectedValueOnce(unexpectedError)

    await expect(() =>
      createChurchUseCase.execute({
        name: 'Igreja Erro',
        address: 'Rua Erro, 999',
        lat: -23.5505,
        lon: -46.6333,
      }),
    ).rejects.toThrow('Database connection failed')
  })

  it('should not create church with empty address', async () => {
    const churchData = {
      name: 'Igreja Online',
      address: '',
      lat: -23.5505,
      lon: -46.6333,
    }

    await expect(() => createChurchUseCase.execute(churchData)).rejects.toBeInstanceOf(NoAddressError)
    expect(churchesRepository.items).toHaveLength(0)
  })

  it('should not create church with whitespace-only address', async () => {
    const churchData = {
      name: 'Igreja Teste',
      address: '   ',
      lat: -23.5505,
      lon: -46.6333,
    }

    await expect(() => createChurchUseCase.execute(churchData)).rejects.toBeInstanceOf(NoAddressError)
    expect(churchesRepository.items).toHaveLength(0)
  })

  it('should create multiple churches with different names and coordinates', async () => {
    const church1 = await createChurchUseCase.execute({
      name: 'Igreja Norte',
      address: 'Rua Norte, 100',
      lat: -23.5,
      lon: -46.6,
    })

    const church2 = await createChurchUseCase.execute({
      name: 'Igreja Sul',
      address: 'Rua Sul, 200',
      lat: -23.6,
      lon: -46.7,
    })

    const church3 = await createChurchUseCase.execute({
      name: 'Igreja Leste',
      address: 'Rua Leste, 300',
      lat: -23.55,
      lon: -46.65,
    })

    expect(church1.id).not.toBe(church2.id)
    expect(church2.id).not.toBe(church3.id)
    expect(church1.lat).toBe(-23.5)
    expect(church2.lat).toBe(-23.6)
    expect(church3.lat).toBe(-23.55)
    expect(churchesRepository.items).toHaveLength(3)
  })

  it('should generate unique publicId for each church', async () => {
    const church1 = await createChurchUseCase.execute({
      name: 'Igreja 1',
      address: 'Rua 1',
      lat: -23.5,
      lon: -46.6,
    })

    const church2 = await createChurchUseCase.execute({
      name: 'Igreja 2',
      address: 'Rua 2',
      lat: -23.6,
      lon: -46.7,
    })

    expect(church1.publicId).not.toBe(church2.publicId)
    expect(church1.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(church2.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})
