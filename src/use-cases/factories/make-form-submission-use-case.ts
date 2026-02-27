import { OutboxFormNotificationPublisher } from '@lib/infra/outbox-publisher/outbox-notification-publisher'
import { DatabaseContext } from '@lib/prisma/helpers/database-context'
import { PrismaFormsRepository } from '@repositories/prisma/prisma-forms-repository'
import { PrismaOutboxRepository } from '@repositories/prisma/prisma-outbox-event-repository'
import { TransactionalUseCaseDecorator } from '@use-cases/decorators/transactional-use-case.decorator'
import { FormsSubmissionUseCase } from '@use-cases/forms/forms-submission'

export function makeFormSubmissionUseCase() {
  // 1. Contexto de Banco de Dados (Gerenciador de Transação)
  // Assumindo que você exporta uma instância do prismaClient em algum lugar, ou cria nova
  const dbContext = new DatabaseContext()

  // 2. Repositórios (Injetamos o dbContext para suportar transações)
  const formsRepository = new PrismaFormsRepository(dbContext)
  const outboxRepository = new PrismaOutboxRepository(dbContext)

  // 3. Infraestrutura (Publisher usa o repositório de outbox)
  const notificationPublisher = new OutboxFormNotificationPublisher(outboxRepository)

  // 4. Use Case Puro (Regra de Negócio)
  const useCase = new FormsSubmissionUseCase(formsRepository, notificationPublisher)

  // 5. Decoração (Envolve o Use Case na Transação)
  // O Decorator intercepta o 'execute'. Se retornar 'err', ele faz rollback.
  return new TransactionalUseCaseDecorator(useCase, dbContext)
}
