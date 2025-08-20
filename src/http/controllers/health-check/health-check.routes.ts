import { FastifyInstance } from 'fastify'
import { healthCheck } from './health-check.controller'

export async function healthCheckRoutes(app: FastifyInstance) {
  app.get('/', healthCheck)
}
