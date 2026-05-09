import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'
import { ErrorType } from 'core/types/error-type/error-type'
import { AppError } from 'errors/base-error'

export abstract class InfrastructureError extends AppError {
  public readonly originalError?: unknown

  constructor(detail: IErrorDetail, originalError?: unknown) {
    // O tipo aqui e mais para fins de categorizacao interna do erro,
    // embora este tipo nao sera enviado em respostas do Fastify.
    super(detail, ErrorType.INTERNAL_SERVER_ERROR)

    this.originalError = originalError

    //Seus loggers globais capturem a stack trace nativamente.
    if (originalError) {
      this.body.originalError =
        originalError instanceof Error ? originalError.stack || originalError.message : originalError
    }
  }
}
