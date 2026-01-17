import { messages } from '@constants/messages'

export class OperationAbortedError extends Error {
  constructor() {
    super(messages.errors.operationAbortedError)
  }
}