import { InfrastructureError } from 'errors/infrastructure-error'
import { Prisma } from '@prisma/client'
import { IErrorMapper } from 'core/contracts/errors/error-mapper.interface'

export interface PrismaInfraErrorMapping {
  P2000?: (originalError?: unknown) => InfrastructureError
  P2001?: (originalError?: unknown) => InfrastructureError
  P2002?: (originalError?: unknown) => InfrastructureError
  P2003?: (originalError?: unknown) => InfrastructureError
  P2025?: (originalError?: unknown) => InfrastructureError
  P2014?: (originalError?: unknown) => InfrastructureError
  P2015?: (originalError?: unknown) => InfrastructureError
  P2016?: (originalError?: unknown) => InfrastructureError
  P2021?: (originalError?: unknown) => InfrastructureError
  P2022?: (originalError?: unknown) => InfrastructureError
  [key: string]: ((originalError?: unknown) => InfrastructureError) | undefined
}

export class PrismaInfraErrorMapper implements IErrorMapper<InfrastructureError> {
  constructor(private readonly errorMapping: PrismaInfraErrorMapping) {}

  mapToKnownError(error: unknown): InfrastructureError | unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const errorFactory = this.errorMapping[error.code]
      if (errorFactory) {
        // Injetamos o erro original para o InfrastructureError não perder o rastro
        return errorFactory(error)
      }
    }
    return error
  }
}
