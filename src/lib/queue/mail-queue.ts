import { logger } from '@lib/logger'
import { createRedisBullMQConnection, attachRedisLogger } from '@lib/redis/redis-bullMQ-connection'
import { Queue } from 'bullmq'

export const MAIL_QUEUE_NAME = 'mail-queue'

export interface MailJobData {
  to: string | undefined
  subject: string
  message: string
  html: string
  context?: Record<string, unknown>
}

const redisForQueue = createRedisBullMQConnection()
attachRedisLogger(redisForQueue)

export const mailQueue = new Queue<MailJobData>(MAIL_QUEUE_NAME, {
  connection: redisForQueue,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

mailQueue.on('error', (err: unknown) => {
  logger.error({ err }, 'Erro da fila de e-mails')
})
