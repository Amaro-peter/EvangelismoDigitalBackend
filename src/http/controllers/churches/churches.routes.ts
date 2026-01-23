import { FastifyInstance } from 'fastify'
import { findNearestChurches } from './find-nearest-churches.controller'
import { createChurch } from './create-church.controller'
import { verifyJwt } from '@middlewares/verify-jwt.middleware'
import { verifyUserRole } from '@middlewares/verify-user-role.middleware'
import { UserRole } from '@prisma/client'
import { deleteChurch } from './delete-church.controller'
import { findChurchPublicIdByName } from './find-church-publicId-by-name.controller'

export async function churchesRoutes(app: FastifyInstance) {
  app.get(
    '/nearest',
    {
      config: {
        rateLimit: {
          max: 30000,
          timeWindow: '1 minute',
        },
      },
    },
    findNearestChurches,
  )

  app.post('/find-church-publicId-by-name', { onRequest: [verifyJwt] }, findChurchPublicIdByName)

  app.post('/create', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, createChurch)

  app.delete('/delete', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, deleteChurch)
}
