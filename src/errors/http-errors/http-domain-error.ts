import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'
import { ErrorType } from 'core/types/error-type/error-type'
import { AppError } from 'errors/base-error'

// Abstract class for future http domain errors implementations.

export abstract class HTTPDomainError extends AppError {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(detail: IErrorDetail, type: ErrorType) {
    super(detail, type)
  }
}
