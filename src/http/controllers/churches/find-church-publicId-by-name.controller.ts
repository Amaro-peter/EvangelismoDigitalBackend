import { findChurchByNameSchema } from '@http/schemas/churches/find-church-by-name-schema'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'
import { makeFindChurchPublicIdByNameUseCase } from '@use-cases/factories/make-find-church-publicId-by-name-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function findChurchPublicIdByName(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name } = findChurchByNameSchema.parse(request.body)

    const findChurchPublicIdByNameUseCase = makeFindChurchPublicIdByNameUseCase()

    const { publicId } = await findChurchPublicIdByNameUseCase.execute({ name })

    return reply.status(200).send({ publicId })
  } catch (error) {
    if (error instanceof ChurchNotFoundError) {
      return reply.status(404).send({ message: error.message })
    }

    throw error
  }
}
