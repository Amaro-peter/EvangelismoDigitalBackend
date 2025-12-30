import { User } from '@prisma/client'
import { UsersRepository, UserUpdateInput } from '@repositories/users-repository'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'

interface UpdateUserUseCaseRequest {
  publicId: string
  name?: string
  email?: string
  username?: string
}

type UpdateUserUseCaseResponse = {
  user: User
}

export class UpdateUserUseCase {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ publicId, name, email, username }: UpdateUserUseCaseRequest): Promise<UpdateUserUseCaseResponse> {
    const userToBeUpdated = await this.usersRepository.findBy({ publicId })

    if (!userToBeUpdated) throw new ResourceNotFoundError()

    const data: UserUpdateInput = {}
    if (name) data.name = name
    if (email) data.email = email
    if (username) data.username = username
    data.updatedAt = new Date()

    const userWithExistingEmail = await this.usersRepository.findBy({ email })

    if (userWithExistingEmail && userWithExistingEmail.publicId !== userToBeUpdated.publicId) {
      throw new UserAlreadyExistsError()
    }

    const usernameWithExistingUsername = await this.usersRepository.findBy({ username })

    if (usernameWithExistingUsername && usernameWithExistingUsername.publicId !== userToBeUpdated.publicId) {
      throw new UserAlreadyExistsError()
    }

    const user = await this.usersRepository.update(userToBeUpdated.publicId, {
      ...data,
    })

    if (!user) {
      throw new Error('Error updating user')
    }

    return { user }
  }
}
