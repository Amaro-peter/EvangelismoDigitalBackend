import { logger } from "@lib/logger";
import { Worker } from 'bullmq'
import { MAIL_QUEUE_NAME } from '../mail-queue'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { redisConnection } from '@lib/redis/connection'

const CONCURRENCY_LIMIT = 10 // Ajuste conforme limite do seu SMTP
const RATE_LIMIT = 100 // Limite de taxa (Rate Limit) do provedor de e-mail
const DURATION = 1000 // 100 e-mails por segundo

export async function startMailWorker() {
  logger.info('🚀 Iniciando worker de e-mails')

  const worker = new Worker(
    MAIL_QUEUE_NAME,
    async (job) => {
      const { to, subject, message, html } = job.data

      const sendEmailUseCase = makeSendEmailUseCase()

      logger.info({ jobId: job.id, to }, 'Iniciando processamento de envio de e-mail')

      await sendEmailUseCase.execute({
        to,
        subject,
        message,
        html,
      })

      logger.info({ jobId: job.id, to }, 'E-mail enviado com sucesso via fila')
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY_LIMIT,
      limiter: {
        max: RATE_LIMIT,
        duration: DURATION,
      },
    },
  )

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        err,
        attempt: job?.attemptsMade,
      },
      'Falha no processamento do job de e-mail',
    )
  })

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed')
  })

  return worker
}