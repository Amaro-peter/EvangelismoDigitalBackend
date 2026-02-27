import { HTTPDomainError } from '@http/errors/http-domain-error'
import { Prisma } from '@prisma/client'
import { IErrorMapper } from 'core/contracts/errors/error-mapper.interface'

export interface PrismaHTTPErrorMapping {
  P2000?: () => HTTPDomainError // Value too long for column
  P2001?: () => HTTPDomainError // Record not found in where condition
  P2002?: () => HTTPDomainError // Unique constraint violation
  P2003?: () => HTTPDomainError // Foreign key constraint failed
  P2025?: () => HTTPDomainError // Record not found (update/delete)
  P2014?: () => HTTPDomainError // Relation violation
  P2015?: () => HTTPDomainError // Related record not found
  P2016?: () => HTTPDomainError // Query interpretation error
  P2021?: () => HTTPDomainError // Table does not exist
  P2022?: () => HTTPDomainError // Column does not exist
  [key: string]: (() => HTTPDomainError) | undefined
}

export class PrismaHTTPErrorMapper implements IErrorMapper<HTTPDomainError> {
  constructor(private readonly errorMapping: PrismaHTTPErrorMapping) {}

  mapToKnownError(error: unknown): HTTPDomainError | unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const errorFactory = this.errorMapping[error.code]
      if (errorFactory) {
        return errorFactory()
      }
    }

    return error
  }
}
