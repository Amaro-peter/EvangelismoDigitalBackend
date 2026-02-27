import { HTTPDomainError } from '@http/errors/http-domain-error'
import { HTTPSystemError } from '@http/errors/http-system-error'
import { InfrastructureError } from '@lib/errors/infra/infrastructure-error'
import {
  OUTBOX_EVENT_NOT_FOUND_ERROR,
  OUTBOX_OPERATION_FAILED_ERROR,
} from 'messages/errors/use-cases/outbox-events/outbox-error-messages'

// --- Contexto HTTP (Disparado pela API durante o cadastro) ---
export class OutboxEventNotFoundHttpError extends HTTPDomainError {
  constructor() {
    super(OUTBOX_EVENT_NOT_FOUND_ERROR, 404)
  }
}
export class OutboxOperationFailedHttpError extends HTTPSystemError {
  constructor() {
    super(OUTBOX_OPERATION_FAILED_ERROR, 500)
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
