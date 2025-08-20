import { env } from '@env/index'
import { User } from '@prisma/client'
import { UserRepository } from '@repositories/users-repository'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { hash } from 'bcryptjs'

interface UpdateUserUseCaseRequest {
  publicId: string
  name?: string
  email?: string
  username?: string
  cpf?: string
  password?: string
}

type UpdateUserUseCaseResponse = {
  user: User
}

export class UpdateUserUseCase {
  constructor(private usersRepository: UserRepository) {}

  async execute({ publicId, password, ...data }: UpdateUserUseCaseRequest): Promise<UpdateUserUseCaseResponse> {
    const userToUpdate = await this.usersRepository.findBy({ publicId })

    if (!userToUpdate) throw new ResourceNotFoundError()

    let passwordHash: string | undefined
    let passwordChangedAt: Date | undefined

    if (password) {
      passwordHash = await hash(password, env.HASH_SALT_ROUNDS)
      passwordChangedAt = new Date()
    }

    const user = await this.usersRepository.update(userToUpdate.id, {
      passwordHash,
      passwordChangedAt,
      ...data,
    })

    return { user }
  }
}
