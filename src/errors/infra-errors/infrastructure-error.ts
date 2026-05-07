import { InfrastructureErrorStatusCode } from 'core/constants/errors/status-code-error-constants'
import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'
import { BaseError } from 'errors/base-error'

export abstract class InfrastructureError extends BaseError {
  public readonly originalError?: unknown

  constructor(detail: IErrorDetail, originalError?: unknown) {
    // O status code aqui é mais para fins de categorização interna do erro,
    // embora este código não será enviado em respostas do Fastify.
    super(detail, InfrastructureErrorStatusCode)

    this.originalError = originalError

    // Anexamos o erro original ao "body" do BaseError para que o toJSON()
    // ou os seus loggers globais capturem a stack trace nativamente.
    if (originalError) {
      this.body.originalError =
        originalError instanceof Error ? originalError.stack || originalError.message : originalError
    }
  }
}
