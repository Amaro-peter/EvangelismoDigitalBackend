import { createChurchBodySchema } from '@http/schemas/churches/create-church-schema'
import { ChurchPresenter } from '@http/presenters/church-presenter'
import { logger } from '@lib/logger'
import { ChurchAlreadyExistsError } from '@use-cases/errors/church-already-exists-error'
import { CreateChurchError } from '@use-cases/errors/create-church-error'
import { makeCreateChurchUseCase } from '@use-cases/factories/make-create-church-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function createChurch(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, address, lat, lon } = createChurchBodySchema.parse(request.body)

    logger.info({
      msg: 'Criando uma nova igreja',
    })

    const createChurchUseCase = makeCreateChurchUseCase()

    const church = await createChurchUseCase.execute({
      name,
      address,
      lat,
      lon,
    })

    const sanitizedChurch = ChurchPresenter.toHTTP(church)

    logger.info({
      msg: 'Igreja criada com sucesso',
      church: sanitizedChurch,
    })

    return reply.status(201).send({ church: sanitizedChurch })
  } catch (error) {
    if (error instanceof ChurchAlreadyExistsError) {
      logger.warn({
        msg: 'Tentativa de criar igreja que já existe',
        error: error.message,
      })
      return reply.status(409).send({ message: error.message })
    }

    if (error instanceof CreateChurchError) {
      logger.warn({
        msg: 'Coordenadas inválidas fornecidas ao criar igreja',
        error: error.message,
      })
      return reply.status(400).send({ message: error.message })
    }

    throw error
  }
}
