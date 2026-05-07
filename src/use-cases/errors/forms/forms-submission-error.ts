import { HTTPDomainError } from 'errors/http-errors/http-domain-error'
import { FORM_SUBMISSION_ERROR } from 'messages/errors/use-cases/forms/forms-error-messages'

export class FormsSubmissionError extends HTTPDomainError {
  constructor() {
    super(FORM_SUBMISSION_ERROR, 400)
  }
}
