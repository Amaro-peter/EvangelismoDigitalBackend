import { messages } from '@constants/messages'

export class NoRateLimiterSetError extends Error {
  constructor(reason?: unknown) {
    super(messages.errors.noRateLimiterSetError + ` Reason: ${reason ?? 'Unknown'}`)
  }
}
