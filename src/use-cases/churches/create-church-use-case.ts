import { Prisma } from '@prisma/client'
import { ChurchesRepository } from '@repositories/churches-repository'
import { ChurchAlreadyExistsError } from '@use-cases/errors/church-already-exists-error'
import { CreateChurchError } from '@use-cases/errors/create-church-error'
import { NoAddressError } from '@use-cases/errors/no-address-error'

interface CreateChurchUseCaseRequest {
  name: string
  address: string
  lat: number
  lon: number
}

interface CreateChurchUseCaseResponse {
  id: number
  publicId: string
  name: string
  address: string
  lat: number
  lon: number
  geog?: unknown | null
  createdAt: Date
  updatedAt: Date
}

export class CreateChurchUseCase {
  constructor(private churchesRepository: ChurchesRepository) {}

  async execute({ name, address, lat, lon }: CreateChurchUseCaseRequest): Promise<CreateChurchUseCaseResponse> {
    if (!address || address.trim() === '') {
      throw new NoAddressError()
    }

    const churchWithSameName = await this.churchesRepository.findByName(name)

    if (churchWithSameName !== null) {
      throw new ChurchAlreadyExistsError()
    }

    const churchAlreadyExists = await this.churchesRepository.findByParams({
      name,
      lat,
      lon,
    })

    if (churchAlreadyExists !== null) {
      throw new ChurchAlreadyExistsError()
    }

    try {
      const church = await this.churchesRepository.createChurch({
        name,
        address,
        lat,
        lon,
      })

      if (!church) {
        throw new CreateChurchError()
      }

      return church
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ChurchAlreadyExistsError()
      }

      if (err.message === 'church-already-exists') {
        throw new ChurchAlreadyExistsError()
      }

      throw err
    }
  }
}
