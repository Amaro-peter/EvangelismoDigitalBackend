import { User } from '@prisma/client'
import { UserRepository } from '@repositories/users-repository'

type ListUsersUseCaseResponse = {
  users: User[]
}

export class ListUsersUseCase {
  constructor(private usersRepository: UserRepository) {}

  async execute(): Promise<ListUsersUseCaseResponse> {
    const users = await this.usersRepository.list()

    return { users }
  }
}
