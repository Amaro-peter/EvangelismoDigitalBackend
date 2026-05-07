import { messages } from 'core/constants/messages'

export class ForbiddenError extends Error {
  constructor() {
    super(messages.errors.forbidden)
  }
}
