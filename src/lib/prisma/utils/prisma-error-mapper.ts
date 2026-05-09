import { Prisma } from '@prisma/client'
import { IAppError } from 'core/contracts/errors/app-error.interface'
import { IErrorMapper } from 'core/contracts/errors/error-mapper.interface'

export interface PrismaErrorMapping {
  P2000?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Value too long for column
  P2001?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Record not found in where condition
  P2002?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Unique constraint violation
  P2003?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Foreign key constraint failed
  P2025?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Record not found (update/delete)
  P2014?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Relation violation
  P2015?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Related record not found
  P2016?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Query interpretation error
  P2021?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Table does not exist
  P2022?: (error: Prisma.PrismaClientKnownRequestError) => IAppError // Column does not exist
  [key: string]: ((error: Prisma.PrismaClientKnownRequestError) => IAppError) | undefined
}

export class PrismaErrorMapper implements IErrorMapper<IAppError> {
  constructor(private readonly errorMapping: PrismaErrorMapping) {}

  mapToKnownError(error: unknown): IAppError | unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = error as Prisma.PrismaClientKnownRequestError
      const errorFactory = this.errorMapping[prismaError.code]
      if (errorFactory) {
        return errorFactory(prismaError)
      }
    }

    return error
  }
}
