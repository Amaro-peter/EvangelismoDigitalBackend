import { Prisma, PrismaClient } from '@prisma/client'
import { DefaultArgs } from '@prisma/client/runtime/client'

export type PrismaTransactionClient = Omit<
  PrismaClient<Prisma.PrismaClientOptions, Prisma.LogLevel, DefaultArgs>,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>
