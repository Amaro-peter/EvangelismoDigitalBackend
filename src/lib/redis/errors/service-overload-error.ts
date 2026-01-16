import { messages } from '@constants/messages'

export class ServiceOverloadError extends Error {
  constructor() {
    super(messages.errors.serviceOverloadError)
  }
}
