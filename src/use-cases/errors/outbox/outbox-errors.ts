import { InfrastructureError } from 'errors/infrastructure-error'
import { ErrorType } from 'core/types/error-type/error-type'
import {
  OUTBOX_EVENT_NOT_FOUND_ERROR,
  OUTBOX_OPERATION_FAILED_ERROR,
} from 'messages/errors/use-cases/outbox-events/outbox-error-messages'
import { SystemError } from 'errors/system-error'
import { DomainError } from 'errors/domain-error'

// --- Contexto HTTP (Disparado pela API durante o cadastro) ---
export class OutboxEventNotFoundHttpError extends DomainError {
  constructor() {
    super(OUTBOX_EVENT_NOT_FOUND_ERROR, ErrorType.NOT_FOUND)
  }
}

export class OutboxOperationFailedHttpError extends SystemError {
  constructor() {
    super(OUTBOX_OPERATION_FAILED_ERROR, ErrorType.INTERNAL_SERVER_ERROR)
  }
}

// --- Contexto Infraestrutura (Disparado pelo BullMQ / Cron) ---
export class OutboxEventNotFoundInfraError extends InfrastructureError {
  constructor(originalError?: unknown) {
    super(OUTBOX_EVENT_NOT_FOUND_ERROR, originalError)
  }
}

export class OutboxOperationFailedInfraError extends InfrastructureError {
  constructor(originalError?: unknown) {
    super(OUTBOX_OPERATION_FAILED_ERROR, originalError)
  }
}
