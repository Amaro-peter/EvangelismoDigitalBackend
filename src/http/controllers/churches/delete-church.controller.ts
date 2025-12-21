import { deleteChurchBodySchema } from "@http/schemas/churches/delete-church-schema";
import { logger } from "@lib/logger";
import { makeDeleteChurchUseCase } from "@use-cases/factories/make-delete-church-use-case";
import { FastifyReply, FastifyRequest } from "fastify";


export async function deleteChurch(request: FastifyRequest, reply: FastifyReply) {
    try {
        const { publicId }  = deleteChurchBodySchema.parse(request.body)

        logger.info({
            msg: 'Deletando uma igreja',
        })

        const deleteChurchUseCase = makeDeleteChurchUseCase()

        const result = await deleteChurchUseCase.execute({
          publicId,
        })

        const removeId = (obj: Record<string, any>) => {
          if (!obj || typeof obj !== 'object') return obj
          const { id, ...rest } = obj
          return rest
        }

        const sanitizedChurch = removeId(result.church as Record<string, any>)

        logger.info({
            msg: 'Igreja deletada com sucesso',
            church: {
                publicId: sanitizedChurch.publicId,
                name: sanitizedChurch.name,
                address: sanitizedChurch.address,
                lat: sanitizedChurch.lat,
                lon: sanitizedChurch.lon,
                geog: sanitizedChurch.geog,
            }
        })

        return reply.status(200).send({ sanitizedChurch })
    } catch(err: any) {
        logger.error({
            msg: 'Erro ao deletar a igreja',
            error: err,
        })

        throw err
    }
}