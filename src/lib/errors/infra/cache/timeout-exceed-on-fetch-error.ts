import { messages } from 'core/constants/messages'

export class TimeoutExceededOnFetchError extends Error {
  public readonly originalReason?: unknown

  constructor(reason?: unknown) {
    super(messages.errors.timeoutExceededOnFetch)

    this.name = 'TimeoutExceededOnFetchError'
    this.originalReason = reason
  }
}
