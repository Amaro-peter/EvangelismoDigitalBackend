import { FastifyInstance } from 'fastify'
import { resetPassword } from './reset-password.controller'
import { register, registerAdmin } from './register-user.controller'
import { verifyJwt } from '@middlewares/verify-jwt.middleware'
import { verifyUserRole } from '@middlewares/verify-user-role.middleware'
import { authenticateUser } from './authenticate-user.controller'
import { deleteUser, deleteUserByPublicId } from './delete-user.controller'
import { forgotPassword } from './forgot-password.controller'
import { getUserByPublicId, getUserProfile } from './get-user-profile.controller'
import { updateUser, updateUserByPublicId } from './update-user.controller'
import { UserRole } from '@prisma/client'
import { listUsers } from './list-users.controller'

export async function usersRoutes(app: FastifyInstance) {
  // Register routes:
  app.post('/register/admin', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, registerAdmin)
  app.post('/register', register)

  // Authentication routes:
  app.post('/sessions', authenticateUser)
  app.post('/forgot-password', forgotPassword)
  app.patch('/reset-password', resetPassword)

  // User routes:
  app.patch('/me', { onRequest: [verifyJwt] }, updateUser)
  app.get('/me', { onRequest: [verifyJwt] }, getUserProfile)
  app.delete('/me', { onRequest: [verifyJwt] }, deleteUser)

  // Users administration routes:
  app.patch('/:publicId', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, updateUserByPublicId)
  app.delete('/:publicId', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, deleteUserByPublicId)
  app.get('/:publicId', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, getUserByPublicId)
  app.get('/', { onRequest: [verifyJwt, verifyUserRole([UserRole.ADMIN])] }, listUsers)
}
