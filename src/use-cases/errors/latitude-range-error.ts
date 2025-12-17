import { messages } from '@constants/messages'

export class LatitudeRangeError extends Error {
  constructor() {
    super(messages.latitude.outOfRange)
  }
}