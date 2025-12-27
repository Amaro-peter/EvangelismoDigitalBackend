import type { FastifyReply, FastifyRequest } from 'fastify'
import { forgotPasswordSchema } from '@http/schemas/users/forgot-password-schema'
import { makeForgotPasswordUseCase } from '@use-cases/factories/make-forgot-password-use-case'
import { logger } from '@lib/logger'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { forgotPasswordTextTemplate } from '@templates/forgot-password/forgot-password-text'
import { forgotPasswordHtmlTemplate } from '@templates/forgot-password/forgot-password-html'
import { messages } from '@constants/messages'
import { UserNotFoundForPasswordResetError } from '@use-cases/errors/user-not-found-for-password-reset-error'

export async function forgotPassword(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { email } = forgotPasswordSchema.parse(request.body)

    if (!email) {
      throw new UserNotFoundForPasswordResetError()
    }

    const forgotPasswordUseCase = makeForgotPasswordUseCase()

    const { user, token } = await forgotPasswordUseCase.execute({ email })

    const sendEmailUseCase = makeSendEmailUseCase()

    await sendEmailUseCase.execute({
      to: user.email,
      subject: messages.email.passwordRecoverySubject,
      message: forgotPasswordTextTemplate(user.name, token),
      html: forgotPasswordHtmlTemplate(user.name, token),
    })

    logger.info({ targetId: user.publicId }, 'Password reset email sent')

    return reply.status(200).send({ message: messages.info.passwordResetGeneric })
  } catch (error) {
    if (error instanceof UserNotFoundForPasswordResetError) {
      return reply.status(200).send({ message: error.message })
    }

    throw error
  }
}
