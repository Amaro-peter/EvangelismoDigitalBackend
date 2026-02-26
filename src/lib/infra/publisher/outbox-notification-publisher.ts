import { IFormNotificationPublisher } from "core/contracts/infra/form-notification-publisher"
import { IOutboxRepository, OutboxEvent, OutboxEventType } from "core/contracts/repository/outbox-repository"
import { FormPayload } from "core/types/use-cases/forms/form-payload"

export class OutboxFormNotificationPublisher implements IFormNotificationPublisher {
  constructor(private outboxRepository: IOutboxRepository) {}

  async publishToOutbox(form: FormPayload): Promise<OutboxEvent> {
    const payload = {
      name: form.name,
      email: form.email,
      lastName: form.lastName,
      decisaoPorCristo: form.decisaoPorCristo,
      location: form.location || null,
    }

    // Usa o novo método create com o formato InputData
    const outboxEvent = await this.outboxRepository.create({
      status: OutboxEventType.PENDING,
      type: 'FormSubmissionCreated',
      payload,
    })

    return outboxEvent
  }
}
