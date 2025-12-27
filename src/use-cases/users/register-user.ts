import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { Prisma, User } from '@prisma/client'
import { hash } from 'bcryptjs'
import { env } from '@env/index'
import { UserRole, UsersRepository } from '@repositories/users-repository'
import { UserNotCreatedError } from '@use-cases/errors/user-not-created-error'

interface RegisterUserUseCaseRequest {
  name: string
  email: string
  cpf: string
  password: string
  username: string
  role: UserRole
}

type RegisterUserUseCaseResponse = {
  user: User
}

export class RegisterUserUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({
    name,
    email,
    cpf,
    username,
    password,
    role,
  }: RegisterUserUseCaseRequest): Promise<RegisterUserUseCaseResponse> {
    try {
      const passwordHash = await hash(password, env.HASH_SALT_ROUNDS)

      const user = await this.usersRepository.create({
        name,
        email,
        cpf,
        username,
        passwordHash,
        role,
      })

      if (!user) {
        throw new UserNotCreatedError()
      }

      return { user }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UserAlreadyExistsError()
      }

      throw error
    }
  }
}
