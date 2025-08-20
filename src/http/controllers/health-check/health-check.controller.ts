import type { FastifyRequest, FastifyReply } from 'fastify'
import { logger } from '@lib/logger'
import { logError } from '@lib/logger/helpers'
import { prisma } from '@lib/prisma'

export async function healthCheck(_request: FastifyRequest, reply: FastifyReply) {
  const startTime = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`

    const uptime = process.uptime()
    const timestamp = new Date().toISOString()
    const duration = Date.now() - startTime

    logger.info({ uptime, duration }, 'Healthcheck successful')

    return reply.status(200).send({ status: 'ok', uptime, timestamp })
  } catch (error) {
    const duration = Date.now() - startTime
    logError(error, { duration }, 'Healthcheck failed')

    return reply.status(500).send({ status: 'error', message: 'Internal healthcheck error' })
  }
}
