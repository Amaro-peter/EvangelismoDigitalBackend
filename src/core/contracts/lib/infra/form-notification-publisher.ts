import { FormPayload } from 'core/types/use-cases/forms/form-payload'
import { Result } from 'core/shared/result'
import { OutboxEvent } from 'core/contracts/repository/outbox-repository'

export interface IFormNotificationPublisher {
  publishToOutbox(form: FormPayload): Promise<Result<OutboxEvent, Error>>
}
