import { logger } from "@lib/logger"
import { redisConnection } from "@lib/redis/connection"
import { Queue } from "bullmq"

export const MAIL_QUEUE_NAME = 'mail-queue'

export interface MailJobData {
  to: string | undefined
  subject: string
  message: string
  html: string
  context?: Record<string, unknown>
}

export const mailQueue = new Queue<MailJobData>(MAIL_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
})

mailQueue.on('error', (err: unknown) => {
    logger.error({ err }, 'Erro da fila de e-mails')
})