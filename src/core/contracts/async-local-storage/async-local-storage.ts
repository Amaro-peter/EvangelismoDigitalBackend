import { PrismaTransactionClient } from 'core/types/prisma/prisma-transaction-client'

export interface IAsyncContext {
  requestId: string
  requestInfo: {
    host: string
    protocol: string
    userAgent: string
  }
  userId?: string
  prismaTransaction?: PrismaTransactionClient
}
