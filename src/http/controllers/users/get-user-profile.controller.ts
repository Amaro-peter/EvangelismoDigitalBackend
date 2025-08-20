import type { FastifyReply, FastifyRequest } from 'fastify'
import { logger } from '@lib/logger'
import { UserPresenter } from '@http/presenters/user-presenter'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { makeGetUserProfileUseCase } from '@use-cases/factories/make-get-user-profile-use-case'
import { publicIdSchema } from '@http/schemas/utils/public-id-schema'

export async function getUserProfile(request: FastifyRequest, reply: FastifyReply) {
  try {
    const getUserProfileUseCase = makeGetUserProfileUseCase()

    const { user } = await getUserProfileUseCase.execute({ publicId: request.user.sub })

    logger.info('User profile retrieved successfully!')

    return reply.status(200).send(UserPresenter.toHTTP(user))
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}

export async function getUserByPublicId(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { publicId } = publicIdSchema.parse(request.params)

    const getUserProfileUseCase = makeGetUserProfileUseCase()

    const { user } = await getUserProfileUseCase.execute({ publicId: publicId })

    logger.info('User retrieved successfully!')

    return reply.status(200).send(UserPresenter.toHTTP(user))
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}
