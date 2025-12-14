import { formsSchema } from '@http/schemas/forms/forms-schema'
import { logger } from '@lib/logger'
import { mailQueue } from '@lib/queue/mail-queue'
import { contactInternalHtmlTemplate } from '@templates/contact-internal/contact-internal-html'
import { contactInternalSubjectTextTemplate } from '@templates/contact-internal/contact-internal-subject-text'
import { contactInternalTextTemplate } from '@templates/contact-internal/contact-internal-text'
import { contactUserHtmlTemplate } from '@templates/contact-user/contact-user-html'
import { contactUserSubjectTextTemplate } from '@templates/contact-user/contact-user-subject-text'
import { contactUserTextTemplate } from '@templates/contact-user/contact-user-text'
import { decisionInternalHtmlTemplate } from '@templates/decision-internal/decision-internal-html'
import { decisionInternalSubjectText } from '@templates/decision-internal/decision-internal-subject-text'
import { decisionInternalTextTemplate } from '@templates/decision-internal/decision-internal-text'
import { decisionUserHtmlTemplate } from '@templates/decision-user/decision-user-html'
import { decisionUserSubjectText } from '@templates/decision-user/decision-user-subject-text'
import { decisionUserTextTemplate } from '@templates/decision-user/decision-user-text'
import { FormSubmissionError } from '@use-cases/errors/form-submission-error'
import { makeFormSubmissionUseCase } from '@use-cases/factories/make-form-submission-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function formSubmission(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { name, lastName, email, decisaoPorCristo, location } = formsSchema.parse(request.body)

    const formSubmissionUseCase = makeFormSubmissionUseCase()

    // 1. Persistência no Banco de Dados (Operação Rápida)
    const { formSubmission } = await formSubmissionUseCase.execute({
      name,
      lastName,
      email,
      decisaoPorCristo,
      location,
    })

    logger.info({ formSubmissionId: formSubmission.publicId }, 'Submissão de formulário enviada com sucesso!')

    // 2. Enfileiramento de E-mails (Producer)

    if (decisaoPorCristo) {
      await mailQueue.add('decision-for-Christ-user-email', {
        to: email,
        subject: decisionUserSubjectText(),
        message: decisionUserTextTemplate(name),
        html: decisionUserHtmlTemplate(name),
        context: { type: 'decision-for-Christ', recipient: 'user' },
      })

      await mailQueue.add('decision-for-Christ-internal-email', {
        to: process.env.ADMIN_EMAIL,
        subject: decisionInternalSubjectText(),
        message: decisionInternalTextTemplate(name, email, location),
        html: decisionInternalHtmlTemplate(name, lastName, email, location),
        context: { type: 'decision-for-Christ', recipient: 'internal' },
      })
    } else {
      await mailQueue.add('contact-user-email', {
        to: email,
        subject: contactUserSubjectTextTemplate(),
        message: contactUserTextTemplate(name),
        html: contactUserHtmlTemplate(name),
        context: { type: 'contact', recipient: 'user' },
      })

      await mailQueue.add('contact-internal-email', {
        to: process.env.ADMIN_EMAIL,
        subject: contactInternalSubjectTextTemplate(),
        message: contactInternalTextTemplate(name, email),
        html: contactInternalHtmlTemplate(name, lastName, email),
        context: { type: 'contact', recipient: 'internal' },
      })
    }

    reply.status(201).send({ formSubmission })
  } catch (error) {
    if (error instanceof FormSubmissionError) {
      return reply.status(500).send({ message: error.message })
    }

    throw error
  }
}
