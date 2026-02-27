import { FormPayload } from "core/types/use-cases/forms/form-payload";
import { OutboxEvent } from "../repository/outbox-repository";
import { Result } from 'core/shared/result'

export interface IFormNotificationPublisher {
  publishToOutbox(form: FormPayload): Promise<Result<OutboxEvent, Error>>
}

