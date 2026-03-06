import { IOutboxEventRegistration } from 'core/contracts/use-cases/outbox-event/outbox-event.interface'
import { IOutboxRepository, IOutboxEvent, IOutboxEventType } from 'core/contracts/repository/outbox-repository'
import { Result } from 'core/shared/result'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export class OutboxEventUseCase implements IOutboxEventRegistration {
  constructor(private outboxRepository: IOutboxRepository) {}

  async register(form: FormPayload): Promise<Result<IOutboxEvent, Error>> {
    const payload = {
      name: form.name,
      email: form.email,
      lastName: form.lastName,
      decisaoPorCristo: form.decisaoPorCristo,
      location: form.location || null,
    }

    // Usa o novo método create com o formato InputData
    const outboxEvent = await this.outboxRepository.create({
      status: IOutboxEventType.PENDING,
      type: 'FormSubmissionCreated',
      payload,
    })

    return outboxEvent
  }
}
