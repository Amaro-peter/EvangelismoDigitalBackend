import { messages } from '@constants/messages'

export class LongitudeRangeError extends Error {
  constructor() {
    super(messages.longitude.outOfRange)
  }
}