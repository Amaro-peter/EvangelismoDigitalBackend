import { HTTPDomainError } from 'errors/http-domain-error'
import { FORM_ALREADY_EXISTS_ERROR } from 'messages/errors/use-cases/forms/forms-error-messages'

export class FormsAlreadyExistsError extends HTTPDomainError {
  constructor() {
    super(FORM_ALREADY_EXISTS_ERROR, 409)
  }
}
