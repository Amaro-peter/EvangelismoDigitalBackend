import { SendEmailUseCase } from '@use-cases/messaging/send-email'

export function makeSendEmailUseCase() {
  return new SendEmailUseCase()
}
