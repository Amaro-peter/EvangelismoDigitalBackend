import { messages } from '@constants/messages'

export class ResourceNotFoundError extends Error {
  constructor() {
    super(messages.errors.resourceNotFound)
  }
}
