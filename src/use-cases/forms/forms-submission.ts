import { IOutboxEventRegistration } from 'core/contracts/use-cases/outbox-event/outbox-event.interface'
import { FormsRepository, IFormSubmissionInputData } from 'core/contracts/repository/forms-repository'
import { IOutboxEvent } from 'core/contracts/repository/outbox-repository'
import { ok, Result } from 'core/shared/result'
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
    private eventRegistration: IOutboxEventRegistration,
  ) {}

  async execute(request: IFormSubmissionInputData): Promise<Response> {
    const findEmailResult = await this.formsSubmissionRepository.findByEmail(request.email)

    if (findEmailResult.success === false) {
      return findEmailResult
    }

    // 2. Persistência (Escrita)
    // Como este UseCase será decorado, esta chamada ocorrerá dentro de uma transação do Prisma
    const formSubmissionResult = await this.formsSubmissionRepository.create({
      name: request.name,
      lastName: request.lastName,
      email: request.email,
      decisaoPorCristo: request.decisaoPorCristo,
      location: request.location || undefined,
    })

    if (formSubmissionResult.success === false) {
      return formSubmissionResult
    }

    const formSubmission = formSubmissionResult.value

    // Sanitização: Remove campos sensíveis ou desnecessários para a notificação

    const sanitizedFormSubmission = {
      name: formSubmission.name,
      lastName: formSubmission.lastName,
      email: formSubmission.email,
      decisaoPorCristo: formSubmission.decisaoPorCristo,
      location: formSubmission.location ?? null,
    }

    // 3. Side-Effect Seguro (Outbox Pattern)
    // Salva o evento na tabela 'outbox_events' NA MESMA TRANSAÇÃO do formulário
    const outboxEvent = await this.eventRegistration.register(sanitizedFormSubmission)

    if (outboxEvent.success === false) {
      return outboxEvent
    }

    // 4. Retorno de Sucesso
    return ok({
      sanitizedFormSubmission,
      outboxEvent: outboxEvent.value,
    })
  }
}
