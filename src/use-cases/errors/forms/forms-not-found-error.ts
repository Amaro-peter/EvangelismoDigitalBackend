import { ErrorType } from 'core/types/error-type/error-type'
import { DomainError } from 'errors/domain-error'
import { FORM_NOT_FOUND_ERROR } from 'messages/errors/use-cases/forms/forms-error-messages'

export class FormsNotFoundError extends DomainError {
  constructor() {
    super(FORM_NOT_FOUND_ERROR, ErrorType.NOT_FOUND)
  }
}
