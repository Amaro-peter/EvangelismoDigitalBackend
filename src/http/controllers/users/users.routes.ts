import { FastifyInstance } from 'fastify'
import { resetPassword } from './reset-password.controller'
import { register, registerAdmin } from './register-user.controller'
import { verifyJwt } from '@middlewares/verify-jwt.middleware'
import { verifyUserRole } from '@middlewares/verify-user-role.middleware'
import { authenticateUser } from './authenticate-user.controller'
import { deleteUser, deleteUserByPublicId } from './delete-user.controller'
import { forgotPassword } from './forgot-password.controller'
import { getUserByPublicId, getUserProfile } from './get-user-profile.controller'
import { updateUser } from './update-user.controller'
import { UserRole } from '@prisma/client'
import { listUsers } from './list-users.controller'
import rateLimit from '@fastify/rate-limit'
import { verifyUserOrAdmin } from '@middlewares/verify-user-or-admin.middleware'
import { searchUsersController } from './search-users.controller'

export async function usersRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    max: 2000,
    timeWindow: '1 minute',
  })

  // Register routes:
  app.post(
    '/register/admin',
    {
      onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])],
      config: { rateLimit: { max: 15, timeWindow: '1 hour' } },
    },
    registerAdmin,
  )
  app.post('/register', { config: { rateLimit: { max: 1000, timeWindow: '1 minute' } } }, register)

  // Authentication routes:
  app.post('/sessions', authenticateUser)
  app.post('/forgot-password', { config: { rateLimit: { max: 100, timeWindow: '1 hour' } } }, forgotPassword)
  app.patch('/reset-password', { config: { rateLimit: { max: 200, timeWindow: '1 hour' } } }, resetPassword)

  // User routes:
  app.patch('/me', { onRequest: [verifyJwt, verifyUserOrAdmin()] }, updateUser)
  app.get('/me', { onRequest: [verifyJwt, verifyUserOrAdmin()] }, getUserProfile)
  app.delete('/me', { onRequest: [verifyJwt, verifyUserOrAdmin()] }, deleteUser)

  // List users route:
  app.get(
    '/',
    {
      onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    listUsers,
  )
  app.get('/search', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, searchUsersController)

  // Users administration routes:
  app.patch('/:publicId', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, updateUser)
  app.delete(
    '/:publicId',
    {
      onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])],
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    deleteUserByPublicId,
  )
  app.get('/:publicId', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, getUserByPublicId)
}
