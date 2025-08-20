import { PrismaUsersRepository } from '@repositories/prisma/prisma-users-repository'
import { DeleteUserUseCase } from '@use-cases/users/delete-user'

export function makeDeleteUserUseCase() {
  const usersRepository = new PrismaUsersRepository()
  const deleteUserUseCase = new DeleteUserUseCase(usersRepository)

  return deleteUserUseCase
}
