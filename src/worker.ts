import { startOutboxCron } from '@lib/infra/jobs/outbox-cron'
import { OutboxProcessor } from '@lib/infra/jobs/outbox-processor'
import { logger } from '@lib/logger'
import { DatabaseContext } from '@lib/prisma/helpers/database-context'
import { startMailWorker } from '@lib/queue/workers/mail-worker'
import { OutboxSignal } from '@lib/redis/events/outbox-signal'
import { PrismaOutboxRepository } from '@repositories/prisma/prisma-outbox-event-repository'
import { Worker } from 'bullmq'
import { OutboxEvent } from 'core/contracts/repository/outbox-repository'

let worker: Worker | null = null
let shuttingDown = false

async function bootstrap() {
  try {
    logger.info('🔧 Inicializando serviços de background...')

    worker = await startMailWorker()
    logger.info('✅ Mail worker iniciado')

    const dbContext = new DatabaseContext()
    const outboxRepository = new PrismaOutboxRepository(dbContext)
    const outboxProcessor = new OutboxProcessor(outboxRepository)

    await OutboxSignal.subscribe(async (publicId: string, event: OutboxEvent) => {
      await outboxProcessor.processSingleEvent(event)
    })

    logger.info('✅ OutboxSignal inscrito e pronto para receber sinais')

    startOutboxCron(outboxProcessor)
  } catch (error) {
    logger.fatal({ error }, '🔥 Erro fatal ao iniciar os workers')
    process.exit(1)
  }
}

// Graceful Shutdown
async function shutdown(signal: string, exitCode: number = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  logger.info(`Recebido sinal ${signal}. Iniciando shutdown do worker...`)

  // Desconecta o OutboxSignal (publisher + subscriber) antes de tudo
  try {
    await OutboxSignal.disconnect()
    logger.info('OutboxSignal desconectado com sucesso')
  } catch (err) {
    logger.error(err, 'Erro ao desconectar o OutboxSignal')
    exitCode = 1
  }

  if (worker) {
    try {
      // Fecha o worker do BullMQ graciosamente (espera jobs ativos terminarem)
      await worker.close()
      logger.info('Worker finalizado com sucesso')
    } catch (err) {
      logger.error(err, 'Erro ao finalizar o worker')
      exitCode = 1
    }
  }

  // O Cron (node-cron) é parado automaticamente quando o processo morre via process.exit
  process.exit(exitCode)
}

// Signal handling
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGUSR2', () => shutdown('SIGUSR2'))

// Process-level error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Promise Rejection')
})

process.on('uncaughtException', async (error: unknown) => {
  logger.fatal({ error }, 'Uncaught Exception thrown')
  await shutdown('UNCAUGHT_EXCEPTION', 1)
})

// Start
bootstrap()
