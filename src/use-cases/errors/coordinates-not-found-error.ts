import { messages } from '@constants/messages'

export class CoordinatesNotFoundError extends Error {
  constructor() {
    super(messages.errors.coordinatesNotFound)
  }
}
