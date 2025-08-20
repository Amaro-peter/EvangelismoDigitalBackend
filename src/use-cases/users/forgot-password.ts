import { emailSchema } from '@http/schemas/utils/email'
import { User } from '@prisma/client'
import { UserRepository } from '@repositories/users-repository'
import { UserNotFoundForPasswordResetError } from '@use-cases/errors/user-not-found-for-password-reset-error'
import { randomBytes } from 'crypto'

interface ForgotPasswordUseCaseRequest {
  login: string
}

type ForgotPasswordUseCaseResponse = {
  user: User
  token: string
}

const EXPIRES_IN_MINUTES = 15
const TOKEN_LENGTH = 32

export class ForgotPasswordUseCase {
  constructor(private usersRepository: UserRepository) {}

  async execute({ login }: ForgotPasswordUseCaseRequest): Promise<ForgotPasswordUseCaseResponse> {
    let userExists: User | null = null

    if (emailSchema.safeParse(login).success) {
      userExists = await this.usersRepository.findBy({ email: login })
    } else {
      userExists = await this.usersRepository.findBy({ username: login })
    }

    const passwordToken = randomBytes(TOKEN_LENGTH).toString('hex')

    const tokenExpiresAt = new Date(Date.now() + EXPIRES_IN_MINUTES * 60 * 1000)

    const tokenData = {
      token: passwordToken,
      tokenExpiresAt,
    }

    if (!userExists) throw new UserNotFoundForPasswordResetError()

    const user = await this.usersRepository.update(userExists.id, {
      ...tokenData,
    })

    return {
      user,
      token: passwordToken,
    }
  }
}
