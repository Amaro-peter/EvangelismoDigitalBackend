import { messages } from '@constants/messages'

export class LocationIqProviderError extends Error {
  constructor() {
    super(messages.errors.locationIqProviderError)
  }
}