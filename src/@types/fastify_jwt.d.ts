import '@fastify/jwt'
import { UserRole } from '@prisma/client'

declare module '@fastify/jwt' {
  export interface FastifyJWT {
    user: {
      role: UserRole
      sub: string
    }
  }
}
