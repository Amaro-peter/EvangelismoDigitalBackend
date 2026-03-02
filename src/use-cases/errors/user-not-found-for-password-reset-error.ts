import { messages } from 'core/constants/messages'

export class UserNotFoundForPasswordResetError extends Error {
  constructor() {
    super(messages.info.passwordResetGeneric)
  }
}
