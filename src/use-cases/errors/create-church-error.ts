import { messages } from '@constants/messages'

export class CreateChurchError extends Error {
  constructor() {
    super(messages.errors.createChurchFailed)
  }
}
