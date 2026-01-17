import { messages } from '@constants/messages'

export class AddressProviderFailureError extends Error {
  constructor() {
    super(messages.errors.addressProviderFailureError)
  }
}
