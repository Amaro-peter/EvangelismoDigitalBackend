import { FormSubmissionError } from '@use-cases/errors/form-submission-error'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { IFormNotificationPublisher } from 'core/contracts/lib/infra/form-notification-publisher'
import { FormsRepository, FormSubmissionData } from 'core/contracts/repository/forms-repository'
import { IOutboxEvent } from 'core/contracts/repository/outbox-repository'
import { err, ok, Result } from 'core/shared/result'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

type Response = Result<
  {
    sanitizedFormSubmission: FormPayload
    outboxEvent: IOutboxEvent
  },
  Error
>

export class FormsSubmissionUseCase {
  constructor(
    private formsSubmissionRepository: FormsRepository,
    private notificationPublisher: IFormNotificationPublisher,
  ) {}

  async execute(request: FormSubmissionData): Promise<Response> {
    const userAlreadyExists = await this.formsSubmissionRepository.findByEmail(request.email)

    if (userAlreadyExists) {
      return err(new UserAlreadyExistsError())
    }

    // 2. Persistência (Escrita)
    // Como este UseCase será decorado, esta chamada ocorrerá dentro de uma transação do Prisma
    const formSubmission = await this.formsSubmissionRepository.create({
      name: request.name,
      lastName: request.lastName,
      email: request.email,
      decisaoPorCristo: request.decisaoPorCristo,
      location: request.location || undefined,
    })

    if (!formSubmission) {
      return err(new FormSubmissionError())
    }

    const sanitizedFormSubmission = {
      name: formSubmission.name,
      lastName: formSubmission.lastName,
      email: formSubmission.email,
      decisaoPorCristo: formSubmission.decisaoPorCristo,
      location: formSubmission.location ?? null,
    }

    // 3. Side-Effect Seguro (Outbox Pattern)
    // Salva o evento na tabela 'outbox_events' NA MESMA TRANSAÇÃO do formulário
    const outboxEvent = await this.notificationPublisher.publishToOutbox(sanitizedFormSubmission)

    if (outboxEvent.success === false) {
      return err(outboxEvent.error)
    }

    // 4. Retorno de Sucesso
    return ok({
      sanitizedFormSubmission,
      outboxEvent: outboxEvent.value,
    })
  }
}
