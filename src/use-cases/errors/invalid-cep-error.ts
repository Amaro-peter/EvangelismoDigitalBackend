import { messages } from '@constants/messages'

export class InvalidCepError extends Error {
  constructor() {
    super(messages.errors.cepDoesNotExist)
  }
}
