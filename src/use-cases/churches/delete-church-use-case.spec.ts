import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeleteChurchUseCase } from './delete-church-use-case'
import { CreateChurchUseCase } from './create-church-use-case'
import { InMemoryChurchesRepository } from '@repositories/in-memory/in-memory-chuches-repository'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'

describe('Delete Church Use Case', () => {
  let churchesRepository: InMemoryChurchesRepository
  let deleteChurchUseCase: DeleteChurchUseCase
  let createChurchUseCase: CreateChurchUseCase

  beforeEach(() => {
    churchesRepository = new InMemoryChurchesRepository()
    deleteChurchUseCase = new DeleteChurchUseCase(churchesRepository)
    createChurchUseCase = new CreateChurchUseCase(churchesRepository)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should delete a church successfully by publicId', async () => {
    // Create a church first
    const church = await createChurchUseCase.execute({
      name: 'Igreja a ser deletada',
      address: 'Rua Teste, 123',
      lat: -23.5505,
      lon: -46.6333,
    })

    expect(churchesRepository.items).toHaveLength(1)

    // Delete the church
    const { church: deletedChurch } = await deleteChurchUseCase.execute({
      publicId: church.publicId,
    })

    expect(deletedChurch).toMatchObject({
      id: church.id,
      publicId: church.publicId,
      name: church.name,
      address: church.address,
      lat: church.lat,
      lon: church.lon,
    })
    expect(churchesRepository.items).toHaveLength(0)
  })

  it('should throw ChurchNotFoundError when publicId does not exist', async () => {
    const nonExistentPublicId = '550e8400-e29b-41d4-a716-446655440000'

    await expect(() => deleteChurchUseCase.execute({ publicId: nonExistentPublicId })).rejects.toBeInstanceOf(
      ChurchNotFoundError,
    )
  })

  it('should only delete the church with matching publicId', async () => {
    // Create multiple churches
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

    const church3 = await createChurchUseCase.execute({
      name: 'Igreja 3',
      address: 'Rua 3',
      lat: -23.7,
      lon: -46.8,
    })

    expect(churchesRepository.items).toHaveLength(3)

    // Delete only church2
    await deleteChurchUseCase.execute({ publicId: church2.publicId })

    expect(churchesRepository.items).toHaveLength(2)
    expect(churchesRepository.items.find((c) => c.publicId === church1.publicId)).toBeDefined()
    expect(churchesRepository.items.find((c) => c.publicId === church2.publicId)).toBeUndefined()
    expect(churchesRepository.items.find((c) => c.publicId === church3.publicId)).toBeDefined()
  })

  it('should throw ChurchNotFoundError when trying to delete already deleted church', async () => {
    const church = await createChurchUseCase.execute({
      name: 'Igreja para deletar duas vezes',
      address: 'Rua Teste',
      lat: -23.5505,
      lon: -46.6333,
    })

    // First deletion should succeed
    await deleteChurchUseCase.execute({ publicId: church.publicId })

    // Second deletion should fail
    await expect(() => deleteChurchUseCase.execute({ publicId: church.publicId })).rejects.toBeInstanceOf(
      ChurchNotFoundError,
    )
  })

  it('should return the deleted church data', async () => {
    const churchData = {
      name: 'Igreja a Retornar',
      address: 'Rua da Igreja, 456',
      lat: -22.9068,
      lon: -43.1729,
    }

    const created = await createChurchUseCase.execute(churchData)

    const { church: deleted } = await deleteChurchUseCase.execute({
      publicId: created.publicId,
    })

    expect(deleted.name).toBe(churchData.name)
    expect(deleted.address).toBe(churchData.address)
    expect(deleted.lat).toBe(churchData.lat)
    expect(deleted.lon).toBe(churchData.lon)
    expect(deleted.publicId).toBe(created.publicId)
  })

  it('should throw ChurchNotFoundError with invalid publicId format', async () => {
    await expect(() => deleteChurchUseCase.execute({ publicId: 'invalid-id' })).rejects.toBeInstanceOf(
      ChurchNotFoundError,
    )
  })

  it('should throw ChurchNotFoundError with empty publicId', async () => {
    await expect(() => deleteChurchUseCase.execute({ publicId: '' })).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should handle repository returning null gracefully', async () => {
    vi.spyOn(churchesRepository, 'deleteChurchByPublicId').mockResolvedValueOnce(null)

    await expect(() =>
      deleteChurchUseCase.execute({ publicId: '550e8400-e29b-41d4-a716-446655440000' }),
    ).rejects.toBeInstanceOf(ChurchNotFoundError)
  })

  it('should allow creating a new church with the same name after deletion', async () => {
    const churchData = {
      name: 'Igreja Recriável',
      address: 'Rua Original, 100',
      lat: -23.5505,
      lon: -46.6333,
    }

    // Create first church
    const church1 = await createChurchUseCase.execute(churchData)
    expect(churchesRepository.items).toHaveLength(1)

    // Delete it
    await deleteChurchUseCase.execute({ publicId: church1.publicId })
    expect(churchesRepository.items).toHaveLength(0)

    // Create another church with the same name but different location
    const church2 = await createChurchUseCase.execute({
      name: churchData.name,
      address: 'Rua Nova, 200',
      lat: -22.9068,
      lon: -43.1729,
    })

    expect(churchesRepository.items).toHaveLength(1)
    expect(church2.name).toBe(churchData.name)
    expect(church2.publicId).not.toBe(church1.publicId)
  })
})
