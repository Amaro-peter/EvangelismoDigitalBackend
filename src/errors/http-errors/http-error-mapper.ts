import { FastifyReply } from 'fastify'
import { HTTPDomainError } from './http-domain-error'
import { HTTPSystemError } from 'errors/http-errors/http-system-error'

export class HttpErrorMapper {
  static map(error: Error, reply: FastifyReply) {
    if (error instanceof HTTPDomainError || error instanceof HTTPSystemError) {
      return reply.status(error.statusCode).send({
        message: error.body.message,
        code: error.body.code,
        issues: error.body.issues,
      })
    }

    throw error
  }
}
