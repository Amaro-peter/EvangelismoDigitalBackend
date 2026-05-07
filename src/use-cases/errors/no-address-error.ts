import { messages } from 'core/constants/messages'

export class NoAddressError extends Error {
  constructor() {
    super(messages.errors.noAddressProvided)
  }
}
