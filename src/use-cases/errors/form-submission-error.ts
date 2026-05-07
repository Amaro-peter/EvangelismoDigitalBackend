import { messages } from 'core/constants/messages'

export class FormSubmissionError extends Error {
  constructor() {
    super(messages.errors.formSubmissionFailed)
  }
}
