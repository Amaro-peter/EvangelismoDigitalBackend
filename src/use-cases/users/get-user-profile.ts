import { User } from '@prisma/client'
import { UserRepository } from '@repositories/users-repository'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

interface GetUserProfileUseCaseRequest {
  publicId: string
}

type GetUserProfileUseCaseResponse = {
  user: User
}

export class GetUserProfileUseCase {
  constructor(private usersRepository: UserRepository) {}

  async execute({ publicId }: GetUserProfileUseCaseRequest): Promise<GetUserProfileUseCaseResponse> {
    const user = await this.usersRepository.findBy({ publicId })

    if (!user) throw new ResourceNotFoundError()

    return { user }
  }
}
