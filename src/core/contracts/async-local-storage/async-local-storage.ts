import { PrismaTransactionClient } from '@lib/prisma/helpers/prisma-transaction-client'

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
