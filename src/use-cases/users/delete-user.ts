import { UsersRepository } from 'core/contracts/repository/users-repository.interface'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

interface DeleteUserUseCaseRequest {
  publicId: string
}

export class DeleteUserUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ publicId }: DeleteUserUseCaseRequest): Promise<void> {
    const userExists = await this.usersRepository.findBy({ publicId })

    if (!userExists) throw new ResourceNotFoundError()

    await this.usersRepository.delete(userExists.publicId)
  }
}
