import { JOB_ALREADY_PROCESSING_ERROR } from 'messages/errors/system/queue'
import { InfrastructureError } from '../../../errors/infrastructure-error'

export class JobAlreadyProcessingError extends InfrastructureError {
  constructor() {
    super(JOB_ALREADY_PROCESSING_ERROR)
  }
}
