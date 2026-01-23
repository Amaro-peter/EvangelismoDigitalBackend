import { messages } from '@constants/messages'

export class ViaCepProviderError extends Error {
  constructor() {
    super(messages.errors.viaCepProviderError)
  }
}