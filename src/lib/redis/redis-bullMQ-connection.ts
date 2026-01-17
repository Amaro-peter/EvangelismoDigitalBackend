import { env } from '@env/index'
import { logger } from '@lib/logger'
import Redis from 'ioredis'

export function createRedisBullMQConnection() {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > 10) return null
      return Math.min(times * 100, 3000)
    },
    lazyConnect: true,
    // tls: {}, // Uncomment if you need SSL
  })
}

export function attachRedisLogger(redis: Redis) {
  redis.on('connect', () => {
    logger.info('🔗 Redis connection established')
  })
  redis.on('error', (error) => {
    logger.error({ error }, '❌ Redis connection error')
  })
  redis.on('ready', () => {
    logger.info('✅ Redis is ready to accept commands')
  })
}
