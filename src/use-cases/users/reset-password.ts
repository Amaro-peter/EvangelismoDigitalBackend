import type { UserRepository } from '@repositories/users-repository'
import { hash } from 'bcryptjs'
import { env } from '@env/index'
import { InvalidTokenError } from '@use-cases/errors/invalid-token-error'
import { User } from '@prisma/client'
import { UserNotFoundForPasswordResetError } from '@use-cases/errors/user-not-found-for-password-reset-error'

interface ResetPasswordUseCaseCaseRequest {
  token: string
  password: string
}

type ResetPasswordUseCaseCaseResponse = {
  user: User
}

export class ResetPasswordUseCase {
  constructor(private readonly usersRepository: UserRepository) {}

  async execute({ token, password }: ResetPasswordUseCaseCaseRequest): Promise<ResetPasswordUseCaseCaseResponse> {
    const passwordHash = await hash(password, env.HASH_SALT_ROUNDS)

    const passwordChangedAt = new Date()

    const userExists = await this.usersRepository.findBy({ token })

    if (!userExists) {
      throw new UserNotFoundForPasswordResetError()
    }

    if (!userExists.tokenExpiresAt || userExists.tokenExpiresAt < new Date()) {
      throw new InvalidTokenError()
    }

    const user = await this.usersRepository.update(userExists.publicId, {
      passwordHash,
      passwordChangedAt,
    })

    return { user }
  }
}
