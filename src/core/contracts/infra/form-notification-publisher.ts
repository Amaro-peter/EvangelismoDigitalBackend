import { FormPayload } from "core/types/use-cases/forms/form-payload";
import { OutboxEvent } from "../repository/outbox-repository";

export interface IFormNotificationPublisher {
  publishToOutbox(form: FormPayload): Promise<OutboxEvent>
}

