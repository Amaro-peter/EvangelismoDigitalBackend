import { PrismaTransactionClient } from '@lib/infra/prisma/prisma-transaction-client'

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
