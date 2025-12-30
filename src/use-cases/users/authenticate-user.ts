import { emailSchema } from '@http/schemas/utils/email'
import { User } from '@prisma/client'
import { UsersRepository } from '@repositories/users-repository'
import { InvalidCredentialsError } from '@use-cases/errors/invalid-credentials-error'
import { compare } from 'bcryptjs'

interface AuthenticateUserUseCaseRequest {
  login: string
  password: string
}

type AuthenticateUserUseCaseResponse = {
  user: User
}

const DUMMY_HASH = '$2a$12$tlPzU0pvKy33GEnCkOCipeNJC1Ho4NHro4XwveiXUM5xChZj3ua9y'

export class AuthenticateUserUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ login, password }: AuthenticateUserUseCaseRequest): Promise<AuthenticateUserUseCaseResponse> {
    let user: User | null = null

    if (emailSchema.safeParse(login).success) {
      user = await this.usersRepository.findBy({ email: login })
    } else {
      user = await this.usersRepository.findBy({ username: login })
    }

    if (!user) {
      throw new InvalidCredentialsError()
    }

    const hashToCompare = user?.passwordHash || DUMMY_HASH

    const doesPasswordMatch = await compare(password, hashToCompare)

    if (!doesPasswordMatch) throw new InvalidCredentialsError()

    return { user }
  }
}
