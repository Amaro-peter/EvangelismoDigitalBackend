import { User } from '@prisma/client'
import { UsersRepository } from '@repositories/users-repository'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

type ListUsersUseCaseResponse = {
  users: User[]
}

export class ListUsersUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute(): Promise<ListUsersUseCaseResponse> {
    const users = await this.usersRepository.list()

    if (!users || users.length === 0) {
      throw new ResourceNotFoundError()
    }

    return { users }
  }
}
