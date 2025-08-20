import { PrismaUsersRepository } from '@repositories/prisma/prisma-users-repository'
import { ResetPasswordUseCase } from '@use-cases/users/reset-password'

export function makeResetPasswordUseCase() {
  const usersRepository = new PrismaUsersRepository()
  const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

  return resetPasswordUseCase
}
