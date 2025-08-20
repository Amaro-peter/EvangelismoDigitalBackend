import type { FastifyReply, FastifyRequest } from 'fastify'
import { logger } from '@lib/logger'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { makeDeleteUserUseCase } from '@use-cases/factories/make-delete-user-use-case'
import { publicIdSchema } from '@http/schemas/utils/public-id-schema'

export async function deleteUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    const deleteUserUseCase = makeDeleteUserUseCase()

    await deleteUserUseCase.execute({
      publicId: request.user.sub,
    })

    logger.info('User deleted successfully!')

    return reply.status(204).send()
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}

export async function deleteUserByPublicId(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { publicId } = publicIdSchema.parse(request.params)

    const deleteUserUseCase = makeDeleteUserUseCase()

    await deleteUserUseCase.execute({
      publicId,
    })

    logger.info({ targetId: publicId }, 'User deleted successfully!')

    return reply.status(204).send()
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}
