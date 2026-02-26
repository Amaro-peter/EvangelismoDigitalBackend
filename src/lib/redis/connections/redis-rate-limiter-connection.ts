import { env } from '@env/index'
import { logger } from '@lib/logger'
import Redis from 'ioredis'

export function createRedisRateLimiterConnection() {
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,

    // === DIFERENÇAS CHAVE PARA O RATE LIMITER ===

    // 1. Timeout agressivo. Rate Limit tem que ser instantâneo.
    // Se demorar mais que 100ms, aborta para não segurar a API.
    commandTimeout: 100, // Cache costuma ser 1000ms

    // 2. SEM fila offline.
    // Se a conexão cair, falhe o comando imediatamente (throw error).
    // Não queremos acumular verificações de limite na RAM.
    enableOfflineQueue: false,

    // 3. Poucas retentativas.
    // Se falhou, falhou. O 'Fail-Open' na classe RateLimiter vai lidar com isso.
    maxRetriesPerRequest: 0,
  })

  redis.on('error', (error) => {
    // Log level 'warn' em vez de 'error' para não poluir demais se o Redis cair,
    // já que temos estratégia de fail-open.
    logger.warn({ error: error.message }, '⚠️ Redis Rate Limiter connection warning')
  })

  return redis
}
