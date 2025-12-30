import { User } from '@prisma/client'
import { hash } from 'bcryptjs'
import { InvalidTokenError } from '../errors/invalid-token-error'
import { UsersRepository } from '@repositories/users-repository'
import { env } from '@env/index'

interface ResetPasswordUseCaseCaseRequest {
  token: string
  password: string
}

type ResetPasswordUseCaseCaseResponse = {
  user: User
}

export class ResetPasswordUseCase {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute({ token, password }: ResetPasswordUseCaseCaseRequest): Promise<ResetPasswordUseCaseCaseResponse> {
    const userExists = await this.usersRepository.findByToken({ token: token })

    if (!userExists || !userExists.tokenExpiresAt || userExists.tokenExpiresAt < new Date()) {
      throw new InvalidTokenError()
    }

    const passwordHash = await hash(password, env.HASH_SALT_ROUNDS)

    const user = await this.usersRepository.updatePassword(userExists.publicId, {
      passwordHash: passwordHash,
      passwordChangedAt: new Date(),
      token: null,
      tokenExpiresAt: null,
      updatedAt: new Date(),
    })

    if (!user) {
      throw new Error('Failed to update user')
    }

    return { user }
  }
}
