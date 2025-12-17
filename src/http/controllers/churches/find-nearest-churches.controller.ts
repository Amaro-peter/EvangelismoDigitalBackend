import {
  findNearestChurchesQuerySchema,
  FindNearestChurchesQuery,
} from '@http/schemas/churches/find-nearest-churches-schema'
import { logger } from '@lib/logger'
import { LatitudeRangeError } from '@use-cases/errors/latitude-range-error'
import { LongitudeRangeError } from '@use-cases/errors/longitude-range-error'
import { makeFindNearestChurchesUseCase } from '@use-cases/factories/make-find-nearest-churches-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function findNearestChurches(
  request: FastifyRequest<{ Querystring: FindNearestChurchesQuery }>,
  reply: FastifyReply,
) {
  try {
    const { lat, lon } = findNearestChurchesQuerySchema.parse(request.query)

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Encontrando igrejas mais próximas',
        userLat: lat,
        userLon: lon,
        ip: request.ip,
      })
    }

    const findNearestChurchesUseCase = makeFindNearestChurchesUseCase()

    const { churches, totalFound } = await findNearestChurchesUseCase.execute({
      userLat: lat,
      userLon: lon,
    })

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Igrejas mais próximas encontradas com sucesso',
        totalFound,
        userLat: lat,
        userLon: lon,
      })
    }

    const churchesWithoutId = churches.map(({ id, ...church }) => church)

    return reply.status(200).send({ churches: churchesWithoutId, totalFound })
  } catch (error) {
    if (error instanceof LatitudeRangeError || error instanceof LongitudeRangeError) {
      logger.warn({
        msg: 'Invalid coordinates provided',
        error: error.message,
        lat: request.query.lat,
        lon: request.query.lon,
        ip: request.ip,
      })
      return reply.status(400).send({ message: error.message })
    }

    logger.error({
      msg: 'Error finding nearest churches',
      error,
      lat: request.query.lat,
      lon: request.query.lon,
      ip: request.ip,
    })

    throw error
  }
}
