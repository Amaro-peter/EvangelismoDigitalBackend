import { messages } from '@constants/messages'

export class GeoProviderFailureError extends Error {
  constructor() {
    super(messages.errors.geoProviderFailureError)
  }
}