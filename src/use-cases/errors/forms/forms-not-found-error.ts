import { HTTPDomainError } from 'errors/http-domain-error'
import { FORM_NOT_FOUND_ERROR } from 'messages/errors/use-cases/forms/forms-error-messages'

export class FormsNotFoundError extends HTTPDomainError {
  constructor() {
    super(FORM_NOT_FOUND_ERROR, 404)
  }
}
