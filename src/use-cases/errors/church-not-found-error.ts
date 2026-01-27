import { messages } from '@constants/messages'

export class ChurchNotFoundError extends Error {
  constructor() {
    super(messages.errors.churchNotFound)
  }
}
