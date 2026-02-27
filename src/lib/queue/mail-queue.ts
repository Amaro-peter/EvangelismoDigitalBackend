import { logger } from '@lib/logger'
import { redisForQueue } from '@lib/redis/clients/clients'
import { attachRedisLogger } from '@lib/redis/connections/redis-bullMQ-connection'
import { Queue } from 'bullmq'
import { OutboxDispatchData } from 'core/contracts/lib/infra/outbox-dispatch-data'

export const MAIL_QUEUE_NAME = 'mail-queue'

attachRedisLogger(redisForQueue, 'MailQueue')

export const mailQueue = new Queue<OutboxDispatchData>(MAIL_QUEUE_NAME, {
  connection: redisForQueue,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
})

mailQueue.on('error', (err: unknown) => {
  logger.error({ err }, '❌ Erro na MailQueue (Producer)')
})
