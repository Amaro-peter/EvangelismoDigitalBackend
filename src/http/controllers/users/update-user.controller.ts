import type { FastifyReply, FastifyRequest } from 'fastify'
import { logger } from '@lib/logger'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { UserPresenter } from '@http/presenters/user-presenter'
import { makeUpdateUserUseCase } from '@use-cases/factories/make-update-user-use-case'
import { updateSchema } from '@http/schemas/users/update-schema'
import { publicIdSchema } from '@http/schemas/utils/public-id-schema'

export async function updateUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    const bodyParse = updateSchema.safeParse(request.body)
    if (!bodyParse.success) {
      return reply.status(400).send({
        message: 'Dados de registro inválidos!',
      })
    }
    const { name, email } = bodyParse.data

    const paramsParse = publicIdSchema.safeParse(request.params)
    if (!paramsParse.success) {
      return reply.status(400).send({
        message: 'Parâmetros inválidos!',
      })
    }
    const { publicId } = paramsParse.data

    const updateUserUseCase = makeUpdateUserUseCase()

    const { user } = await updateUserUseCase.execute({
      publicId,
      name,
      email,
    })

    logger.info('User updated successfully!')

    return reply.status(200).send(UserPresenter.toHTTP(user))
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}

export async function updateUserByPublicId(request: FastifyRequest, reply: FastifyReply) {
  try {
    const bodyParse = updateSchema.safeParse(request.body)
    if (!bodyParse.success) {
      return reply.status(400).send({
        message: 'Dados de registro inválidos!',
      })
    }
    const { name, email } = bodyParse.data

    const paramsParse = publicIdSchema.safeParse(request.params)
    if (!paramsParse.success) {
      return reply.status(400).send({
        message: 'Parâmetros inválidos!',
      })
    }
    const { publicId } = paramsParse.data

    const updateUserUseCase = makeUpdateUserUseCase()

    const { user } = await updateUserUseCase.execute({
      publicId,
      name,
      email,
    })

    logger.info('User updated successfully!')

    return reply.status(200).send(UserPresenter.toHTTP(user))
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}