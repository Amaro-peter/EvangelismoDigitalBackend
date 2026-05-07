import { SendEmailUseCase } from '@use-cases/email/send-email'

export function makeSendEmailUseCase() {
  return new SendEmailUseCase()
}
