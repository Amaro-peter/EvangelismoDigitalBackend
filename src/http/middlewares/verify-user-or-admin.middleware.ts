import { messages } from '@constants/messages'
import { UserRole } from '@prisma/client'
import { FastifyReply, FastifyRequest } from 'fastify'

export function verifyUserOrAdmin(paramName = 'publicId') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authUser = request.user as any

    if (!authUser) {
      return reply.status(401).send({ message: messages.errors.unauthorized ?? 'Unauthorized' })
    }

    if (authUser.role === UserRole.ADMIN) {
      return
    }

    const target = (request.params as any)?.[paramName]

    if(!target) {
      return
    }

    const userIdCandidates = [authUser.sub, authUser.publicId].filter(Boolean)

    if (!userIdCandidates.includes(target)) {
      return reply.status(403).send({ message: messages.errors.forbidden ?? 'Forbidden' })
    }
  }
}
