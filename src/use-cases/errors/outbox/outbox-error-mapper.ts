import { PrismaHTTPErrorMapping } from '@lib/prisma/utils/prisma-http-error-mapper'
import { PrismaInfraErrorMapping } from '@lib/prisma/utils/prisma-infra-error-mapper'
import {
  OutboxEventNotFoundHttpError,
  OutboxEventNotFoundInfraError,
  OutboxOperationFailedHttpError,
  OutboxOperationFailedInfraError,
} from './outbox-errors'

export const outboxErrorMapping = {
  // Contexto da API (criação do evento na mesma transação)
  http: {
    P2025: () => new OutboxEventNotFoundHttpError(),
    P2003: () => new OutboxOperationFailedHttpError(),
  } as PrismaHTTPErrorMapping,

  // Contexto dos Workers/Background (recuperação, status, deleção)
  infra: {
    P2025: (err?: unknown) => new OutboxEventNotFoundInfraError(err),
    P2003: (err?: unknown) => new OutboxOperationFailedInfraError(err),
  } as PrismaInfraErrorMapping,
}
