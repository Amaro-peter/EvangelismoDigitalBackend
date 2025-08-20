import { PrismaUsersRepository } from '@repositories/prisma/prisma-users-repository'
import { RegisterUserUseCase } from '@use-cases/users/register-user'

export function makeRegisterUserUseCase() {
  const usersRepository = new PrismaUsersRepository()
  const registerUseCase = new RegisterUserUseCase(usersRepository)

  return registerUseCase
}
