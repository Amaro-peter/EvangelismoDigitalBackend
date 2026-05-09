import { ErrorType } from 'core/types/error-type/error-type'
import { DomainError } from 'errors/domain-error'
import { FORM_ALREADY_EXISTS_ERROR } from 'messages/errors/use-cases/forms/forms-error-messages'

export class FormsAlreadyExistsError extends DomainError {
  constructor() {
    super(FORM_ALREADY_EXISTS_ERROR, ErrorType.CONFLICT)
  }
}
