import { ChurchesRepository } from '@repositories/churches-repository'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'

interface FindChurchPublicIdByNameUseCaseRequest {
  name: string
}

interface FindChurchPublicIdByNameUseCaseResponse {
  publicId: string
}

export class FindChurchPublicIdByNameUseCase {
  constructor(private churchesRepository: ChurchesRepository) {}

  async execute({ name }: FindChurchPublicIdByNameUseCaseRequest): Promise<FindChurchPublicIdByNameUseCaseResponse> {
    const church = await this.churchesRepository.findByName(name)

    if (!church) {
      throw new ChurchNotFoundError()
    }

    const publicId = church.publicId

    return { publicId }
  }
}
