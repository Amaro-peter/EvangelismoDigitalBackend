import { FormsAlreadyExistsError } from './forms-already-exists-error'
import { FormsSubmissionError } from './forms-submission-error'
import { FormsNotFoundError } from './forms-not-found-error'
import { PrismaErrorMapping } from '@lib/prisma/utils/prisma-error-mapper'

export const formsErrorMapping: PrismaErrorMapping = {
  P2002: () => new FormsAlreadyExistsError(),
  P2025: () => new FormsNotFoundError(),
  P2003: () => new FormsSubmissionError(),
}
