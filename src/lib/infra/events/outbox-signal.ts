import { REDIS_CHANNELS } from 'core/constants/redis/redis-channells'
import { env } from '@env/index'
import { logger } from '@lib/logger'
import { IOutboxEvent } from 'core/contracts/repository/outbox-repository'
import Redis from 'ioredis'

const baseConfig = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
}

const publisher = new Redis({
  ...baseConfig,
  enableOfflineQueue: true,
  commandTimeout: 2000,
})

const subscriber = new Redis({
  ...baseConfig,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  retryStrategy: (times) => {
    const delay = Math.min(Math.pow(2, times) * 100, 5000)
    logger.warn({
      times,
      delay,
    })

    return delay
  },
})

// ---------------------------------------------------------------------------
// Connection lifecycle events
// --------------------------------------------------------------
publisher.on('connect', () => logger.info('✅ Redis publisher conectado ao outbox-signal'))

publisher.on('error', (err) => logger.error({ err }, '❌ Redis publisher error no outbox-signal'))

publisher.on('close', () => logger.warn('⚠️ Redis publisher connection fechada para outbox-signal'))

subscriber.on('connect', () => logger.info('✅ Redis subscriber conectado para outbox-signal'))

subscriber.on('error', (err) => logger.error({ err }, '❌ Redis subscriber error no outbox-signal'))

subscriber.on('close', () => logger.warn('⚠️ Redis subscriber connection fechada para outbox-signal'))

/** Connects a client only if it hasn't connected yet. */
async function ensureConnected(client: Redis, name: string): Promise<void> {
  if (client.status === 'wait' || client.status === 'close') {
    logger.info(`Conectando ${name}...`)
    await client.connect()
  }
}

type MessageListener = (channel: string, message: string) => void
let activeMessageListener: MessageListener | null = null

export const OutboxSignal = {
  /**
   * Publishes a wakeup signal after a successful outbox write.
   * Fire-and-forget by design: if Redis is unavailable the cron job is the
   * durable fallback, so we swallow the error here intentionally.
   *
   * Call this from your Controller/Service *after* the DB transaction commits.
   */
  async publishNewItem(publicId: string, event: IOutboxEvent): Promise<void> {
    try {
      await ensureConnected(publisher, 'OutboxPublisher')
      await publisher.publish(REDIS_CHANNELS.OUTBOX_SIGNAL, JSON.stringify({ publicId, event }))
    } catch (err) {
      logger.warn(
        { err },
        'Não foi possível publicar sinal de nova outbox. O cron job continuará funcionando como fallback.',
      )
    }
  },

  /**
   * Subscribes the Worker to the outbox channel.
   *
   * Seguro para ser chamado múltiplas vezes: o listener anterior é removido
   * com precisão via `off` antes de registrar o novo, evitando:
   *   1. Listeners duplicados (processamento duplo por mensagem)
   *   2. Memory leak de closures antigas de `onSignal`
   *   3. Destruição acidental dos listeners de lifecycle do subscriber
   *
   * @param onSignal - async callback invoked when a new item is signalled.
   *                   Errors thrown here are caught and logged — they won't
   *                   crash the worker process.
   */
  async subscribe(onSignal: (publicId: string, event: IOutboxEvent) => Promise<void>): Promise<void> {
    try {
      await ensureConnected(subscriber, 'OutboxSubscriber')

      if (activeMessageListener !== null) {
        subscriber.off('message', activeMessageListener)
        logger.info('Listener anterior de OutboxSignal removido com sucesso')
      }

      activeMessageListener = async (channel: string, message: string) => {
        if (channel !== REDIS_CHANNELS.OUTBOX_SIGNAL) {
          logger.warn({ channel }, 'Mensagem recebida em canal inesperado. Ignorando.')
          return
        }

        try {
          const parsed = JSON.parse(message)
          await onSignal(parsed.publicId, parsed.event)
        } catch (err) {
          logger.error({ err, publicId: message }, 'Erro ao processar sinal de Outbox')
        }
      }

      subscriber.on('message', activeMessageListener)

      await subscriber.subscribe(REDIS_CHANNELS.OUTBOX_SIGNAL)
    } catch (err) {
      logger.error({ err }, '❌ Erro ao subscrever ao canal de OutboxSignal')
    }
  },

  async disconnect(): Promise<void> {
    if (activeMessageListener !== null) {
      subscriber.off('message', activeMessageListener)
      activeMessageListener = null
    }

    const targets = [publisher, subscriber]
    await Promise.allSettled(targets.map((c) => (c.status !== 'end' ? c.quit() : Promise.resolve())))
  },
}
