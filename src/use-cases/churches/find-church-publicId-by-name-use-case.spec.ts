import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FindChurchPublicIdByNameUseCase } from './find-church-publicId-by-name-use-case'
import { CreateChurchUseCase } from './create-church-use-case'
import { InMemoryChurchesRepository } from '@repositories/in-memory/in-memory-chuches-repository'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'

describe('Find Church PublicId By Name Use Case', () => {
  let churchesRepository: InMemoryChurchesRepository
  let findChurchPublicIdByNameUseCase: FindChurchPublicIdByNameUseCase
  let createChurchUseCase: CreateChurchUseCase

  beforeEach(() => {
    churchesRepository = new InMemoryChurchesRepository()
    findChurchPublicIdByNameUseCase = new FindChurchPublicIdByNameUseCase(churchesRepository)
    createChurchUseCase = new CreateChurchUseCase(churchesRepository)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should find a church publicId by name successfully', async () => {
    const churchData = {
      name: 'Igreja Batista Central',
      address: 'Rua das Flores, 123',
      lat: -23.5505,
      lon: -46.6333,
    }

    const createdChurch = await createChurchUseCase.execute(churchData)

    const { publicId } = await findChurchPublicIdByNameUseCase.execute({
      name: churchData.name,
    })

    expect(publicId).toBe(createdChurch.publicId)
    expect(publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('should throw ChurchNotFoundError when church does not exist', async () => {
    await expect(() =>
      findChurchPublicIdByNameUseCase.execute({
        name: 'Igreja Inexistente',
      }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should throw ChurchNotFoundError with empty name', async () => {
    await expect(() =>
      findChurchPublicIdByNameUseCase.execute({
        name: '',
      }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should find the correct church when multiple churches exist', async () => {
    const church1 = await createChurchUseCase.execute({
      name: 'Igreja Presbiteriana',
      address: 'Rua A, 100',
      lat: -23.5,
      lon: -46.6,
    })

    const church2 = await createChurchUseCase.execute({
      name: 'Igreja Metodista',
      address: 'Rua B, 200',
      lat: -23.6,
      lon: -46.7,
    })

    const church3 = await createChurchUseCase.execute({
      name: 'Igreja Batista',
      address: 'Rua C, 300',
      lat: -23.7,
      lon: -46.8,
    })

    const { publicId } = await findChurchPublicIdByNameUseCase.execute({
      name: 'Igreja Metodista',
    })

    expect(publicId).toBe(church2.publicId)
    expect(publicId).not.toBe(church1.publicId)
    expect(publicId).not.toBe(church3.publicId)
  })

  it('should be case-sensitive when searching by name', async () => {
    await createChurchUseCase.execute({
      name: 'Igreja Batista',
      address: 'Rua Teste, 123',
      lat: -23.5505,
      lon: -46.6333,
    })

    await expect(() =>
      findChurchPublicIdByNameUseCase.execute({
        name: 'igreja batista',
      }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should throw ChurchNotFoundError for partial name match', async () => {
    await createChurchUseCase.execute({
      name: 'Igreja Batista Central',
      address: 'Rua Teste, 123',
      lat: -23.5505,
      lon: -46.6333,
    })

    await expect(() =>
      findChurchPublicIdByNameUseCase.execute({
        name: 'Igreja Batista',
      }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should handle repository returning null gracefully', async () => {
    vi.spyOn(churchesRepository, 'findByName').mockResolvedValueOnce(null)

    await expect(() =>
      findChurchPublicIdByNameUseCase.execute({
        name: 'Igreja Teste',
      }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should return publicId for church with special characters in name', async () => {
    const churchData = {
      name: 'Igreja São José & Maria',
      address: 'Rua Especial, 456',
      lat: -23.5505,
      lon: -46.6333,
    }

    const createdChurch = await createChurchUseCase.execute(churchData)

    const { publicId } = await findChurchPublicIdByNameUseCase.execute({
      name: churchData.name,
    })

    expect(publicId).toBe(createdChurch.publicId)
  })

  it('should return the same publicId when called multiple times', async () => {
    const churchData = {
      name: 'Igreja Constante',
      address: 'Rua Fixa, 789',
      lat: -23.5505,
      lon: -46.6333,
    }

    await createChurchUseCase.execute(churchData)

    const { publicId: firstCall } = await findChurchPublicIdByNameUseCase.execute({
      name: churchData.name,
    })

    const { publicId: secondCall } = await findChurchPublicIdByNameUseCase.execute({
      name: churchData.name,
    })

    const { publicId: thirdCall } = await findChurchPublicIdByNameUseCase.execute({
      name: churchData.name,
    })

    expect(firstCall).toBe(secondCall)
    expect(secondCall).toBe(thirdCall)
  })
})
