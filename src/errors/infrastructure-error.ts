import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'
import { BaseError } from 'errors/base-error'

export abstract class InfrastructureError extends BaseError {
  public readonly originalError?: unknown

  constructor(detail: IErrorDetail, originalError?: unknown) {
    // Passamos '500' para satisfazer o contrato do BaseError (IAppError),
    // embora este código HTTP não será enviado em respostas do Fastify.
    super(detail, 500)

    this.originalError = originalError

    // Anexamos o erro original ao "body" do BaseError para que o toJSON()
    // ou os seus loggers globais capturem a stack trace nativamente.
    if (originalError) {
      this.body.originalError =
        originalError instanceof Error ? originalError.stack || originalError.message : originalError
    }
  }
}
