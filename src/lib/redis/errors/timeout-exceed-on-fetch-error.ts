import { messages } from '@constants/messages'

export class TimeoutExceedOnFetchError extends Error {
  constructor() {
    super(messages.errors.timeoutExceedOnFetch)
  }
}
