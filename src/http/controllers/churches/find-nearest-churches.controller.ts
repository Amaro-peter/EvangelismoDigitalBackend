import { cepSchema } from '@http/schemas/utils/cep'
import { ChurchPresenter } from '@http/presenters/church-presenter'
import { logger } from '@lib/logger'
import { LatitudeRangeError } from '@use-cases/errors/latitude-range-error'
import { LongitudeRangeError } from '@use-cases/errors/longitude-range-error'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { makeCepToLatLonUseCase } from '@use-cases/factories/make-cep-to-lat-lon-use-case'
import { makeFindNearestChurchesUseCase } from '@use-cases/factories/make-find-nearest-churches-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceedOnFetchError } from '@lib/redis/errors/timeout-exceed-on-fetch-error'
import { ServiceOverloadError } from '@lib/redis/errors/service-overload-error'

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
    const { userLat, userLon, precision } = await cepToLatLonUseCase.execute({ cep })

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

    if (process.env.NODE_ENV !== 'production' || Math.random() < 0.1) {
      logger.info({
        msg: 'Igrejas mais próximas encontradas com sucesso',
        totalFound,
      })
    }

    const sanitizedChurches = ChurchPresenter.toHTTP(churches)

    return reply.status(200).send({ churches: sanitizedChurches, totalFound, precision })
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
