import { createChurchBodySchema } from '@http/schemas/churches/create-church-schema'
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

    const removeId = (obj: Record<string, any>) => {
      if (!obj || typeof obj !== 'object') return obj
      const { id, ...rest } = obj
      return rest
    }

    let sanitizedChurch: any

    if (Array.isArray(church)) {
      sanitizedChurch = church.map(removeId)
    } else if (church && typeof church === 'object' && '0' in church) {
      sanitizedChurch = Object.fromEntries(
        Object.entries(church).map(([k, v]) => [
          k,
          v && typeof v === 'object' ? removeId(v as Record<string, any>) : v,
        ]),
      )
    } else {
      sanitizedChurch = removeId(church as Record<string, any>)
    }

    logger.info({
      msg: 'Igreja criada com sucesso',
      church: sanitizedChurch,
      ...(sanitizedChurch && !Array.isArray(sanitizedChurch) && typeof sanitizedChurch === 'object'
        ? {
            publicId: sanitizedChurch.publicId,
            name: sanitizedChurch.name,
            address: sanitizedChurch.address,
            lat: sanitizedChurch.lat,
            lon: sanitizedChurch.lon,
            geog: sanitizedChurch.geog,
          }
        : {}),
    })

    return reply.status(201).send({ sanitizedChurch })
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
