import { formsSchema } from '@http/schemas/forms/forms-schema'
import { logger } from '@lib/logger'
import { contactInternalHtmlTemplate } from '@templates/contact-internal/contact-internal-html'
import { contactInternalTextTemplate } from '@templates/contact-internal/contact-internal-text'
import { contactUserHtmlTemplate } from '@templates/contact-user/contact-user-html'
import { contactUserTextTemplate } from '@templates/contact-user/contact-user-text'
import { decisionInternalHtmlTemplate } from '@templates/decision-internal/decision-internal-html'
import { decisionInternalTextTemplate } from '@templates/decision-internal/decision-internal-text'
import { decisionUserHtmlTemplate } from '@templates/decision-user/decision-user-html'
import { decisionUserTextTemplate } from '@templates/decision-user/decision-user-text'
import { FormSubmissionError } from '@use-cases/errors/form-submission-error'
import { makeFormSubmissionUseCase } from '@use-cases/factories/make-form-submission-use-case'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function formSubmission(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, lastName, email, decisaoPorCristo, location } = formsSchema.parse(request.body)

    const formSubmissionUseCase = makeFormSubmissionUseCase()

    const { formSubmission } = await formSubmissionUseCase.execute({
      name,
      lastName,
      email,
      decisaoPorCristo,
      location,
    })

    logger.info({ formSubmissionId: formSubmission.publicId }, 'Submissão de formulário enviada com sucesso!')

    reply.status(201).send({ formSubmission })

    const sendEmailUseCase = makeSendEmailUseCase()

    if (decisaoPorCristo) {
      void sendEmailUseCase
        .execute({
          to: email,
          subject: 'Parabéns pela sua decisão!',
          message: decisionUserTextTemplate(name),
          html: decisionUserHtmlTemplate(name),
        })
        .catch((err) => logger.error({ err, to: email }, 'Erro ao enviar e-mail de decisão por Cristo'))

      void sendEmailUseCase
        .execute({
          to: 'pedro.amaro.fe@gmail.com',
          subject: 'Nova decisão por Cristo registrada',
          message: decisionInternalTextTemplate(name, email, location),
          html: decisionInternalHtmlTemplate(name, email, location),
        })
        .catch((err) => logger.error({ err, name, email }, 'Erro ao notificar Time interno sobre decisão por Cristo'))
    } else {
      void sendEmailUseCase
        .execute({
          to: email,
          subject: 'Obrigado pelo seu contato',
          message: contactUserTextTemplate(name),
          html: contactUserHtmlTemplate(name),
        })
        .catch((err) => logger.error({ err, to: email }, 'Erro ao enviar e-mail de agradecimento'))

      // Notification to Pedro about the submitted form
      void sendEmailUseCase
        .execute({
          to: 'pedro.amaro.fe@gmail.com',
          subject: 'Novo formulário enviado',
          message: contactInternalTextTemplate(name, email),
          html: contactInternalHtmlTemplate(name, email),
        })
        .catch((err) => logger.error({ err, name, email }, 'Erro ao notificar Time interno sobre formulário'))
    }
  } catch (error) {
    if (error instanceof FormSubmissionError) {
      return reply.status(500).send({ message: error.message })
    }

    throw error
  }
}
