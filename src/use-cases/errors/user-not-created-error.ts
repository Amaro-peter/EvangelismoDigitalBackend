import { messages } from 'core/constants/messages'

export class UserNotCreatedError extends Error {
  constructor() {
    super(messages.errors.createUserFailed)
  }
}
