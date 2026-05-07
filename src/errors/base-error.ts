import { IAppError } from 'core/contracts/errors/app-error.interface'
import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'

export abstract class BaseError extends Error implements IAppError {
  public statusCode: number
  public body: IErrorDetail

  /**
   * @param detail – the error descriptor (code + message + optional extras)
   * @param statusCode – the protocol status code to be sent in the response. If not provided, it should be set by the subclass.
   */
  protected constructor(detail: IErrorDetail, statusCode: number) {
    super(detail.message)

    this.name = this.constructor.name
    this.statusCode = statusCode

    this.body = {
      code: detail.code,
      message: detail.message,
      ...(detail.issues && { issues: detail.issues }),
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON(): IErrorDetail & { statusCode: number } {
    return {
      statusCode: this.statusCode,
      ...this.body,
    }
  }
}
