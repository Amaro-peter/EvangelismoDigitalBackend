import { messages } from 'core/constants/messages'

export class ResourceNotFoundError extends Error {
  constructor() {
    super(messages.errors.resourceNotFound)
  }
}
