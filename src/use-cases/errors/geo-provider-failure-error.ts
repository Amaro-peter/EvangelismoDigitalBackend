import { messages } from 'core/constants/messages'

export class GeoProviderFailureError extends Error {
  private readonly originalReason: unknown

  constructor(reason?: unknown) {
    super(messages.errors.geoProviderFailureError)

    this.originalReason = reason
  }
}
