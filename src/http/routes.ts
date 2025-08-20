import type { FastifyInstance } from 'fastify'
import { usersRoutes } from '@controllers/users/users.routes'
import { healthCheckRoutes } from '@controllers/health-check/health-check.routes'

export async function appRoutes(app: FastifyInstance) {
  app.register(usersRoutes, { prefix: '/users' })
  app.register(healthCheckRoutes, { prefix: '/health' })
}
