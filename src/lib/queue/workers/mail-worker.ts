import { Worker } from 'bullmq'
import { MAIL_QUEUE_NAME } from '../mail-queue'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { attachRedisLogger } from '@lib/redis/connections/redis-bullMQ-connection'
import { logger } from '@lib/logger'
import { createWorkerConnection } from '@lib/redis/clients/clients'

const CONCURRENCY_LIMIT = 5

export async function startMailWorker() {
  const redisConnection = createWorkerConnection()
  attachRedisLogger(redisConnection)

  const worker = new Worker(
    MAIL_QUEUE_NAME,
    async (job) => {
      const { to, subject, message, html } = job.data
      const sendEmailUseCase = makeSendEmailUseCase()

      // It's good practice to wrap the execution in a child logger for traceability
      const childLogger = logger.child({ jobId: job.id, recipient: to })
      childLogger.info('📨 Processando envio...')

      await sendEmailUseCase.execute({ to, subject, message, html })

      childLogger.info('✅ E-mail enviado com sucesso')
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY_LIMIT,
      lockDuration: 60_000, // Reduced to 60s (standard for most SMTP tasks)
      stalledInterval: 30_000,
      maxStalledCount: 0, // Your strategy: Outbox handles recovery, avoid duplicates.
    },
  )

  // Error handling remains the same as your excellent original implementation
  worker.on('failed', (job, err) => {
    if (err.message.includes('Missing lock') || err.message.includes('job stalled')) {
      logger.warn({ jobId: job?.id }, '⚠️ Falha de rede pós-processamento. Ignorando.')
      return
    }
    logger.error({ jobId: job?.id, err: err.message }, '❌ Falha definitiva no job')
  })

  return worker
}
