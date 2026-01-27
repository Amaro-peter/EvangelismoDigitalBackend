import { messages } from '@constants/messages'

export class AddressProviderFailureError extends Error {
  private readonly originalReason?: unknown

  constructor(reason?: unknown) {
    super(messages.errors.addressProviderFailureError)

    this.originalReason = reason
  }
}
