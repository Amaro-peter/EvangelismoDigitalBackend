import { ChurchesRepository } from '@repositories/churches-repository'
import { CreateChurchError } from '@use-cases/errors/create-church-error'

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
  address: string | null
  lat: number
  lon: number
  geog?: unknown | null
  createdAt: Date
  updatedAt: Date
}

export class CreateChurchUseCase {
  constructor(private churchesRepository: ChurchesRepository) {}

  async execute({ name, address, lat, lon }: CreateChurchUseCaseRequest): Promise<CreateChurchUseCaseResponse> {
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
  }
}
