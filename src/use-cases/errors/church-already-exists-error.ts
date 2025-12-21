import { messages } from '@constants/messages'

export class ChurchAlreadyExistsError extends Error {
  constructor() {
    super(messages.validation.churchAlreadyExists)
  }
}
