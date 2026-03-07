import { User } from '@prisma/client'
import { UsersRepository } from 'core/contracts/repository/users-repository.interface'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

interface SearchUsersUseCaseRequest {
  query: string
  page: number
}

interface SearchUsersUseCaseResponse {
  users: User[]
}

export class SearchUsersUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ query, page }: SearchUsersUseCaseRequest): Promise<SearchUsersUseCaseResponse> {
    const users = await this.usersRepository.search(query, page)

    if (!users || users.length === 0) {
      throw new ResourceNotFoundError()
    }

    return { users }
  }
}
