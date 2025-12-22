import { User } from '@prisma/client'
import { UsersRepository } from '@repositories/users-repository'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

interface UpdateUserUseCaseRequest {
  publicId: string
  name?: string
  email?: string
  username?: string
  cpf?: string
}

type UpdateUserUseCaseResponse = {
  user: User
}

export class UpdateUserUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ publicId, ...data }: UpdateUserUseCaseRequest): Promise<UpdateUserUseCaseResponse> {
    const userToUpdate = await this.usersRepository.findById({ publicId })

    if (!userToUpdate) throw new ResourceNotFoundError()

    const user = await this.usersRepository.update(userToUpdate.publicId, {
      ...data,
    })

    return { user }
  }
}
