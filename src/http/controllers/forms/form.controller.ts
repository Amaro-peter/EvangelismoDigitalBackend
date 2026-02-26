import { FastifyReply, FastifyRequest } from 'fastify'
import { formsSchema } from '@http/schemas/forms/forms-schema'
import { makeFormSubmissionUseCase } from '@use-cases/factories/make-form-submission-use-case'
import { FormSubmissionError } from '@use-cases/errors/form-submission-error'
import { logger } from '@lib/logger'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { OutboxSignal } from '@lib/redis/events/outbox-signal'

export async function formSubmission(request: FastifyRequest, reply: FastifyReply) {
  // 1. Validação de Entrada (Zod)
  const data = formsSchema.parse(request.body)

  // 2. Fábrica (Cria o Use Case com o Decorator Transacional)
  const formSubmissionUseCase = makeFormSubmissionUseCase()

  // 3. Execução
  const result = await formSubmissionUseCase.execute({
    ...data,
  })

  // 4. Tratamento do Result (Pattern Matching manual)
  if (result.success === false) {
    const error = result.error

    // Loga o erro de negócio (opcional, pois não é erro de sistema)
    logger.warn({ email: data.email, error: error.message }, 'Tentativa de submissão de formulário falhou')

    if (error instanceof FormSubmissionError || error instanceof UserAlreadyExistsError) {
      return reply.status(409).send({ message: error.message })
    }

    throw error
  }

  // 5. Sucesso
  const { sanitizedFormSubmission, outboxEvent } = result.value

  OutboxSignal.publishNewItem(outboxEvent.publicId, outboxEvent)

  logger.info({ sanitizedFormSubmission }, 'Formulário recebido com sucesso')

  return reply.status(201).send({
    sanitizedFormSubmission,
  })
}
