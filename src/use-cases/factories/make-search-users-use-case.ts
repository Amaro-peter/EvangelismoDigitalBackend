import { PrismaUsersRepository } from '@repositories/prisma/prisma-users-repository'
import { SearchUsersUseCase } from '@use-cases/users/search-users-use-case'

export function makeSearchUsersUseCase() {
  const usersRepository = new PrismaUsersRepository()
  const searchUsersUseCase = new SearchUsersUseCase(usersRepository)

  return searchUsersUseCase
}
