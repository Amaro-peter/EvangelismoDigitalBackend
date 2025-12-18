import { createChurchBodySchema } from "@http/schemas/churches/create-church-schema";
import { logger } from "@lib/logger";
import { CreateChurchError } from "@use-cases/errors/create-church-error";
import { makeCreateChurchUseCase } from "@use-cases/factories/make-create-church-use-case";
import { FastifyReply, FastifyRequest } from "fastify";


export async function createChurch(
    request: FastifyRequest,
    reply: FastifyReply,
) {
    try {
        const { name, address, lat, lon } = createChurchBodySchema.parse(request.body);

        logger.info({
            msg: 'Criando uma nova igreja',
        })

        const createChurchUseCase = makeCreateChurchUseCase();

        const church = await createChurchUseCase.execute({
            name,
            address,
            lat,
            lon,
        })

        const churchesWithoutId = (({ id, ...church }) => church)(church)

        logger.info({
          msg: 'Igreja criada com sucesso',
          churchName: name,
          churchAddress: address,
          lat: churchesWithoutId.lat,
          lon: churchesWithoutId.lon,
          geog: churchesWithoutId.geog,
        })

        return reply.status(201).send({ church: churchesWithoutId });
    } catch (error) {
        if(error instanceof CreateChurchError) {
            logger.warn({
              msg: 'Invalid coordinates provided',
              error: error.message,
            })
            return reply.status(400).send({ message: error.message })
        }

        throw error
    }
}