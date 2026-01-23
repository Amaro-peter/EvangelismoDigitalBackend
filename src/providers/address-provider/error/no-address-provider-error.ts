import { messages } from '@constants/messages'

export class NoAddressProviderError extends Error {
  constructor() {
    super(messages.errors.noAddressProviderError)
  }
}
