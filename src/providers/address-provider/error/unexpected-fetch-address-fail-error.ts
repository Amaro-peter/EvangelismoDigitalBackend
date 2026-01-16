import { messages } from '@constants/messages'

export class UnexpectedFetchAddressFailError extends Error {
  constructor() {
    super(messages.errors.unexpectedFetchAddressFailError)
  }
}
