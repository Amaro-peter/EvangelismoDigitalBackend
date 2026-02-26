import { Worker } from 'bullmq'
import { MAIL_QUEUE_NAME, OutboxDispatchData } from '../mail-queue'
import { makeSendEmailUseCase } from '@use-cases/factories/make-send-email-use-case'
import { attachRedisLogger } from '@lib/redis/connections/redis-bullMQ-connection'
import { logger } from '@lib/logger'
import { createWorkerConnection } from '@lib/redis/clients/clients'
import { IOutboxRepository } from 'core/contracts/repository/outbox-repository'
import Redis from 'ioredis'
import { env } from '@env/index'

const CONCURRENCY_LIMIT = 5

// 1. CRIAMOS UMA CONEXÃO EXCLUSIVA PARA A APLICAÇÃO (IDEMPOTÊNCIA)
// Nunca misture os comandos da sua regra de negócio com o pipeline do BullMQ
const redisCache = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  family: 4,
})

export async function startMailWorker(outboxRepository: IOutboxRepository) {
  // 2. CONEXÃO EXCLUSIVA PARA O BULLMQ
  const workerConnection = createWorkerConnection()
  attachRedisLogger(workerConnection)

  const worker = new Worker<OutboxDispatchData>(
    MAIL_QUEUE_NAME,
    async (job) => {
      const { publicId, emails } = job.data
      const childLogger = logger.child({ jobId: job.id, publicId })

      const idempotencyKey = `idempotency:email:${publicId}`

      // === ESCUDO DE IDEMPOTÊNCIA BLINDADO E ATÔMICO ===
      // O 'NX' (Not eXists) garante que só o 1º worker que bater aqui consegue escrever.
      // O 'EX' 300 coloca uma trava de 5 minutos enquanto o processamento ocorre.
      const acquired = await redisCache.set(idempotencyKey, 'processing', 'EX', 300, 'NX')

      if (!acquired) {
        // Se bateu aqui, outro processo já trancou a chave. Vamos checar o estado:
        const status = await redisCache.get(idempotencyKey)

        if (status === 'completed') {
          childLogger.warn('⚠️ Lote já enviado anteriormente. Limpando DB e abortando duplicata.')
          // Precisamos garantir que o lixo seja apagado do banco caso a deleção anterior tenha falhado!
          await outboxRepository.delete(publicId)
          return
        }

        // Se estiver como 'processing', forçamos um erro para o BullMQ tentar de novo mais tarde.
        throw new Error('Bloqueio de Idempotência: Job em processamento simultâneo por outra thread.')
      }

      try {
        childLogger.info(`📨 Processando lote de ${emails.length} e-mails...`)

        const sendEmailUseCase = makeSendEmailUseCase()

        // Disparo SMTP
        await Promise.all(emails.map((email) => sendEmailUseCase.execute(email)))

        childLogger.info('✅ Lote de e-mails processado com sucesso.')

        // === REGISTRA SUCESSO DEFINITIVO ===
        // Sobrescrevemos para 'completed' e deixamos expirar sozinho em 24h para não lotar a RAM do Redis
        await redisCache.set(idempotencyKey, 'completed', 'EX', 86400)

        // Limpeza no Banco
        await outboxRepository.delete(publicId)
        childLogger.info('🗑️ OutboxEvent deletado com sucesso do banco de dados')
      } catch (err) {
        // Se o SMTP falhar, DELETAMOS a chave de idempotência para o BullMQ poder tentar de novo do zero.
        await redisCache.del(idempotencyKey)
        throw err
      }
    },
    {
      connection: workerConnection, // Usa a conexão purificada apenas para o BullMQ
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
    logger.error({ jobId: job?.id, err: err.message }, '❌ Falha SMTP definitiva no job')
  })

  return worker
}
