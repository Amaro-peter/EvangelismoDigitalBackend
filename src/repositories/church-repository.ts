import { Prisma, Church } from '@prisma/client'

export interface TokenData {
  token: string | null
  tokenExpiresAt: Date | null
}

export interface ChurchRepository {
  create(data: Prisma.ChurchCreateInput): Promise<Church>
}
