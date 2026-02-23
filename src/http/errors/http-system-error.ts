import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'
import { BaseError } from 'errors/base-error'

// Abstract class for future http system errors implementations.
export abstract class HTTPSystemError extends BaseError {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(detail: IErrorDetail, statusCode: number) {
    super(detail, statusCode)
  }
}
