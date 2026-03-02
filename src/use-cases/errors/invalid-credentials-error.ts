import { messages } from 'core/constants/messages'

export class InvalidCredentialsError extends Error {
  constructor() {
    super(messages.errors.invalidCredentials)
  }
}
