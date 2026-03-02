import { messages } from 'core/constants/messages'

export class LongitudeRangeError extends Error {
  constructor() {
    super(messages.longitude.outOfRange)
  }
}
