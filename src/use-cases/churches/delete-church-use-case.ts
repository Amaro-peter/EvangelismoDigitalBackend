import { Church, ChurchesRepository } from '@repositories/churches-repository'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'

interface DeleteChurchUseCaseRequest {
  publicId: string
}

interface DeleteChurchUseCaseResponse {
  church: Church
}

export class DeleteChurchUseCase {
  constructor(private churchesRepository: ChurchesRepository) {}

  async execute({ publicId }: DeleteChurchUseCaseRequest): Promise<DeleteChurchUseCaseResponse> {
    const deleted = await this.churchesRepository.deleteChurchByPublicId(publicId)
    if (!deleted) {
      throw new ChurchNotFoundError()
    }

    return { church: deleted }
  }
}
