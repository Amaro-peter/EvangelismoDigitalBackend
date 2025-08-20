import { messages } from '@constants/messages'

export class UserNotFoundForPasswordResetError extends Error {
  constructor() {
    super(messages.info.passwordResetGeneric)
  }
}
