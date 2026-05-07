import { messages } from 'core/constants/messages'

export class CepToLatLonError extends Error {
  constructor() {
    super(messages.errors.cepToLatLonError)
  }
}
