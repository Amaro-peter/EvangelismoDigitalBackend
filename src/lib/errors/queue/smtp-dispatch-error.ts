import { SMTP_DISPATCH_ERROR } from 'messages/errors/system/queue'
import { InfrastructureError } from '../../../errors/infra-errors/infrastructure-error'

export class SmtpDispatchError extends InfrastructureError {
  constructor(originalError?: unknown) {
    super(SMTP_DISPATCH_ERROR, originalError)
  }
}
