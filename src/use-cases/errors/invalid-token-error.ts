import { messages } from '@constants/messages'

export class InvalidTokenError extends Error {
  constructor() {
    super(messages.errors.invalidToken)
  }
}
