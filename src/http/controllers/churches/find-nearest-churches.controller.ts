import { cepSchema } from '@http/schemas/utils/cep'
import { logger } from '@lib/logger'
import { User } from '@use-cases/churches/find-the-nearest-church'
import { LatitudeRangeError } from '@use-cases/errors/latitude-range-error'
import { LongitudeRangeError } from '@use-cases/errors/longitude-range-error'
import { makeCepToLatLonUseCase } from '@use-cases/factories/make-cep-to-lat-lon-use-case'
import { makeFindNearestChurchesUseCase } from '@use-cases/factories/make-find-nearest-churches-use-case'
import { makeFindTheNearestChurchesUseCase } from '@use-cases/factories/make-find-the-nearest-church'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function findNearestChurches(
  request: FastifyRequest<{ Querystring: { cep: string } }>,
  reply: FastifyReply,
) {
  try {
    const cep = cepSchema.parse(request.query.cep)

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Cep do usuário recebido para encontrar igrejas próximas',
        ip: request.ip,
      })
    }

    const cepToLatLonUseCase = makeCepToLatLonUseCase()
    const { userLat, userLon } = await cepToLatLonUseCase.execute({ cep })

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Coordenadas obtidas a partir do CEP',
        userLat,
        userLon,
      })
    }

    const findNearestChurchesUseCase = makeFindNearestChurchesUseCase()

    const { churches, totalFound } = await findNearestChurchesUseCase.execute({
      userLat: userLat,
      userLon: userLon,
    })

    const findTheNearestChurchesUseCase = makeFindTheNearestChurchesUseCase()

    const user: User = { userLat, userLon }
    const nearbyChurch = await findTheNearestChurchesUseCase.findNearest({ churches, user })
    logger.info({
      msg: 'Igreja mais próxima encontrada com sucesso',
      nearbyChurch,
    })

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Igrejas mais próximas encontradas com sucesso',
        totalFound,
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const churchesWithoutId = churches.map(({ id, ...church }) => church)

    return reply.status(200).send({ neareatChurchInfo: nearbyChurch, churches: churchesWithoutId, totalFound })
  } catch (error) {
    if (error instanceof LatitudeRangeError || error instanceof LongitudeRangeError) {
      logger.warn({
        msg: 'Invalid coordinates provided',
        error: error.message,
        ip: request.ip,
      })

      return reply.status(400).send({ message: error.message })
    }

    logger.error({
      msg: 'Error finding nearest churches',
      error,
      ip: request.ip,
    })

    throw error
  }
}
