import { Worker } from 'bullmq'
import { MAIL_QUEUE_NAME } from '../queue/mail-queue'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { attachRedisLogger } from '@lib/redis/connections/redis-bullMQ-connection'
import { logger } from '@lib/logger'
import { createWorkerConnection, redisCache } from '@lib/redis/clients/clients'
import { IOutboxRepository } from 'core/contracts/repository/outbox-repository'
import { JobAlreadyProcessingError } from '@lib/errors/queue/job-already-processing-error'
import { SmtpDispatchError } from '@lib/errors/queue/smtp-dispatch-error'
import { InfrastructureError } from '@lib/errors/infra/infrastructure-error'
import { OutboxDispatchData } from 'core/contracts/lib/infra/outbox-dispatch-data'

const CONCURRENCY_LIMIT = 5

export async function startMailWorker(outboxRepository: IOutboxRepository) {
  const workerConnection = createWorkerConnection()
  attachRedisLogger(workerConnection, 'MailWorker')

  const worker = new Worker<OutboxDispatchData>(
    MAIL_QUEUE_NAME,
    async (job) => {
      const { publicId, emails } = job.data
      const childLogger = logger.child({ jobId: job.id, publicId })

      const idempotencyKey = `idempotency:email:${publicId}`

      const acquired = await redisCache.set(idempotencyKey, 'processing', 'EX', 300, 'NX')

      if (!acquired) {
        const status = await redisCache.get(idempotencyKey)

        if (status === 'completed') {
          childLogger.warn('⚠️ Lote já enviado anteriormente. Limpando DB e abortando duplicata.')

          const deleteResult = await outboxRepository.delete(publicId)
          if (deleteResult.success === false) {
            // Lançamos a falha do BD para o BullMQ tentar deletar no próximo ciclo
            throw deleteResult.error
          }
          return
        }

        throw new JobAlreadyProcessingError()
      }

      try {
        childLogger.info(`📨 Processando lote de ${emails.length} e-mails...`)

        const sendEmailUseCase = makeSendEmailUseCase()
        await Promise.all(emails.map((email) => sendEmailUseCase.execute(email)))

        childLogger.info('✅ Lote de e-mails processado com sucesso.')

        await redisCache.set(idempotencyKey, 'completed', 'EX', 86400)

        const deleteResult = await outboxRepository.delete(publicId)

        if (deleteResult.success === false) {
          // Ocorreu um erro no DB (ex: rede caiu). O mapper já converteu para InfraError.
          throw deleteResult.error
        }

        childLogger.info('🗑️ OutboxEvent deletado com sucesso do banco de dados')
      } catch (err) {
        await redisCache.del(idempotencyKey)

        // Se o erro foi lançado pela deleção do BD, apenas repassamos.
        if (err instanceof InfrastructureError) {
          throw err
        }

        // Caso contrário, é um erro do serviço de email
        throw new SmtpDispatchError(err)
      }
    },
    {
      connection: workerConnection,
      concurrency: CONCURRENCY_LIMIT,
      lockDuration: 300_000,
      stalledInterval: 300_000,
    },
  )

  worker.on('failed', (job, err) => {
    if (err.message.includes('Missing lock') || err.message.includes('job stalled')) {
      logger.warn({ jobId: job?.id }, '⚠️ Falha de rede interna do BullMQ após processamento. Ignorando.')
      return
    }

    const isInfrastructureError = 'body' in err && 'statusCode' in err

    if (isInfrastructureError) {
      const infraError = err as unknown as InfrastructureError
      logger.error(
        {
          jobId: job?.id,
          code: infraError.body.code,
          originalError: infraError.body.originalError,
        },
        `❌ Falha de Infraestrutura: ${infraError.message}`,
      )
      return
    }

    logger.error({ jobId: job?.id, err: err.message }, '❌ Falha genérica não mapeada no worker')
  })

  return worker
}
