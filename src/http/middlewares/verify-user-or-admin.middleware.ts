import { messages } from '@constants/messages'
import { FastifyJWT } from '@fastify/jwt'
import { UserRole } from '@repositories/users-repository'
import { FastifyReply, FastifyRequest } from 'fastify'

export function verifyUserOrAdmin(paramName?: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authUser = request.user as FastifyJWT['user']

    if (!authUser) {
      return reply.status(401).send({ message: messages.errors.unauthorized ?? 'Unauthorized' })
    }

    if (authUser.role === UserRole.ADMIN) {
      return
    }

    if (!paramName) {
      return
    }

    const params = request.params as Record<string, unknown>
    const target = params?.[paramName]

    if (typeof target !== 'string') {
      return reply.status(403).send({ message: messages.errors.forbidden ?? 'Forbidden' })
    }

    const ownsResource = target === authUser.publicId

    if (!ownsResource) {
      return reply.status(403).send({ message: messages.errors.forbidden ?? 'Forbidden' })
    }

    return
  }
}
