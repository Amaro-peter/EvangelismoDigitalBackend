import { messages } from 'core/constants/messages'

export class NoGeoProviderError extends Error {
  constructor() {
    super(messages.errors.noGeoProviderError)
  }
}
