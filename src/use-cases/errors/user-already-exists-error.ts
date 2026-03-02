import { messages } from 'core/constants/messages'

export class UserAlreadyExistsError extends Error {
  constructor() {
    super(messages.validation.userAlreadyExists)
  }
}
