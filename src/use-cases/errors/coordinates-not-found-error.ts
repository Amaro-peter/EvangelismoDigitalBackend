import { messages } from 'core/constants/messages'

export class CoordinatesNotFoundError extends Error {
  constructor() {
    super(messages.errors.coordinatesNotFound)
  }
}
