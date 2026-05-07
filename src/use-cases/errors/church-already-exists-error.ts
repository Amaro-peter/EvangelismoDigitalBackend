import { messages } from 'core/constants/messages'

export class ChurchAlreadyExistsError extends Error {
  constructor() {
    super(messages.validation.churchAlreadyExists)
  }
}
