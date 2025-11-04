import type { FastifyReply, FastifyRequest } from 'fastify'
import { logger } from '@lib/logger'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { registerSchema } from '@http/schemas/users/register-schema'
import { makeRegisterUserUseCase } from '@use-cases/factories/make-register-user-use-case'
import { UserRole } from '@prisma/client'
import { UserPresenter } from '@http/presenters/user-presenter'

export async function register(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, email, cpf, username, password } = registerSchema.parse(request.body)

    const registerUseCase = makeRegisterUserUseCase()

    const { user } = await registerUseCase.execute({
      name,
      email,
      cpf,
      password,
      username,
      role: UserRole.DEFAULT,
    })

    logger.info({ userId: user.publicId }, 'Researcher registered successfully!')

    reply.status(201).send({ user: UserPresenter.toHTTP(user) })
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      return reply.status(409).send({ message: error.message })
    }

    throw error
  }
}

export async function registerAdmin(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, email, cpf, username, password } = registerSchema.parse(request.body)

    const registerUseCase = makeRegisterUserUseCase()

    const { user } = await registerUseCase.execute({ name, email, cpf, username, password, role: UserRole.ADMIN })

    return reply.status(201).send({ user: UserPresenter.toHTTP(user) })
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      return reply.status(409).send({ message: error.message })
    }

    throw error
  }
}
