import type { FastifyReply, FastifyRequest } from 'fastify'
import { logger } from '@lib/logger'
import { makeListUsersUseCase } from '@use-cases/factories/make-list-users-use-case'
import { UserPresenter } from '@http/presenters/user-presenter'

export async function listUsers(_request: FastifyRequest, reply: FastifyReply) {
  const listUsers = makeListUsersUseCase()

  const { users } = await listUsers.execute()

  logger.info('Admins retrieved successfully!')

  return reply.status(200).send({ admins: UserPresenter.toHTTP(users) })
}
