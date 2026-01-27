import { messages } from '@constants/messages'

export class CepToLatLonError extends Error {
  constructor() {
    super(messages.errors.cepToLatLonError)
  }
}
