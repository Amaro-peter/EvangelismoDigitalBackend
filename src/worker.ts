import { logger } from '@lib/logger'
import { startMailWorker } from '@lib/queue/workers/mail-worker'
import { Worker } from 'bullmq'

let worker: Worker | null = null
let shuttingDown = false

// Bootstrap
async function bootstrap() {
  try {
    worker = await startMailWorker()
    logger.info('Mail worker iniciado com sucesso')
  } catch (err) {
    logger.error(err, 'Erro ao iniciar o mail worker')
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

  if (worker) {
    try {
      await worker.close()
      logger.info('Worker finalizado com sucesso')
    } catch (err) {
      logger.error(err, 'Erro ao finalizar o worker')
      exitCode = 1
    }
  }

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
  logger.fatal({ error }, 'Uncaught Exception')
  await shutdown('UNCAUGHT_EXCEPTION', 1)
})

bootstrap()
