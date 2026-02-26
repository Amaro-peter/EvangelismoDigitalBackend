import { env } from '@env/index'
import { logger } from '@lib/logger'
import Redis from 'ioredis'

export function createRedisBullMQConnection() {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Obrigatório para BullMQ

    // === CORREÇÃO DE INFRAESTRUTURA (DOCKER) ===
    family: 4, // Força IPv4. Resolve instabilidade de rede no Docker.
    keepAlive: 10000, // Mantém o socket TCP vivo.
    lazyConnect: false, // MUDANÇA: Conecta imediatamente. Workers não devem ser lazy.

    retryStrategy: (times) => {
      // Retry agressivo e infinito
      return Math.min(times * 50, 2000)
    },

    enableOfflineQueue: false,
  })
}

export function attachRedisLogger(redis: Redis) {
  redis.on('connect', () => logger.info('🔗 Redis (Worker) connection established'))
  redis.on('ready', () => logger.info('✅ Redis (Worker) is ready'))
  // Silencia erros de reconexão normais, loga apenas se for crítico
  redis.on('error', (error) => {
    // Evita spam de logs se o Redis estiver reiniciando
    if (!error.message.includes('ECONNREFUSED')) {
      logger.error({ err: error.message }, '❌ Redis connection glitch')
    }
  })
}
