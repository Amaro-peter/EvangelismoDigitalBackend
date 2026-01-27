import { messages } from '@constants/messages'

export class UserNotCreatedError extends Error {
  constructor() {
    super(messages.errors.createUserFailed)
  }
}
