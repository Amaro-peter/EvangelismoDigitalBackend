import { messages } from '@constants/messages'

export class ForbiddenError extends Error {
  constructor() {
    super(messages.errors.forbidden)
  }
}
