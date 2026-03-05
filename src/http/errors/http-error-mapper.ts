import { FastifyReply } from 'fastify'
import { HTTPDomainError } from '../../errors/http-domain-error'

export class HttpErrorMapper {
  static map(error: Error, reply: FastifyReply) {
    if (error instanceof HTTPDomainError) {
      return reply.status(error.statusCode).send({
        message: error.body.message,
        code: error.body.code,
        issues: error.body.issues,
      })
    }

    throw error
  }
}
