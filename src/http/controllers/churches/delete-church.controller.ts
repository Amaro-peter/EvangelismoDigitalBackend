import { deleteChurchBodySchema } from '@http/schemas/churches/delete-church-schema'
import { ChurchPresenter } from '@http/presenters/church-presenter'
import { logger } from '@lib/logger'
import { makeDeleteChurchUseCase } from '@use-cases/factories/make-delete-church-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'
import { ChurchNotFoundError } from '@use-cases/errors/church-not-found-error'

export async function deleteChurch(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { publicId } = deleteChurchBodySchema.parse(request.body)

    logger.info({
      msg: 'Deletando uma igreja',
    })

    const deleteChurchUseCase = makeDeleteChurchUseCase()

    const result = await deleteChurchUseCase.execute({
      publicId,
    })

    const sanitizedChurch = ChurchPresenter.toHTTP(result.church)

    logger.info({
      msg: 'Igreja deletada com sucesso',
      church: sanitizedChurch,
    })

    return reply.status(200).send({ church: sanitizedChurch })
  } catch (error) {
    if (error instanceof ChurchNotFoundError) {
      logger.warn({
        msg: 'Tentativa de deletar igreja que não existe',
        error: error.message,
      })
      return reply.status(404).send({ message: error.message })
    }

    logger.error({
      msg: 'Erro ao deletar a igreja',
      error: error,
    })

    throw error
  }
}
