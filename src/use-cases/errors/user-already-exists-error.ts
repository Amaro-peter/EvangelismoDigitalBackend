import { messages } from '@constants/messages'

export class UserAlreadyExistsError extends Error {
  constructor() {
    super(messages.validation.userAlreadyExists)
  }
}
