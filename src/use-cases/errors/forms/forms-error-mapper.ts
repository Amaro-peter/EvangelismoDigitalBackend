import { PrismaHTTPErrorMapping } from '@lib/prisma/utils/prisma-http-error-mapper'
import { FormsAlreadyExistsError } from './forms-already-exists-error'
import { FormsSubmissionError } from './forms-submission-error'
import { FormsNotFoundError } from './forms-not-found-error'

export const formsErrorMapping = {
  http: {
    P2002: () => new FormsAlreadyExistsError(),
    P2025: () => new FormsNotFoundError(),
    P2003: () => new FormsSubmissionError(),
  } as PrismaHTTPErrorMapping,
}
