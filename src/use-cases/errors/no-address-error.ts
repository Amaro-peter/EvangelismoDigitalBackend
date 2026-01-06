import { messages } from '@constants/messages'

export class NoAddressError extends Error {
  constructor() {
    super(messages.errors.noAddressProvided)
  }
}