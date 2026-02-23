import '@fastify/jwt'
import { UserRole } from 'core/contracts/repository/users-repository'

declare module '@fastify/jwt' {
  export interface FastifyJWT {
    user: {
      sub: string
      role: UserRole
      publicId?: string | undefined
    }
  }
}
