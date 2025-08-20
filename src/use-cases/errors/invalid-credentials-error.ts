import { messages } from '@constants/messages'

export class InvalidCredentialsError extends Error {
  constructor() {
    super(messages.errors.invalidCredentials)
  }
}
