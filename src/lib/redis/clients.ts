// Exemplo de como ficaria (sugestão)
import { createRedisCacheConnection } from './redis-cache-connection'
import { createRedisRateLimiterConnection } from './redis-rate-limiter-connection'
import { createRedisBullMQConnection } from './redis-bullMQ-connection'

// Instâncias Singleton (Lazy loading opcional)
export const redisCache = createRedisCacheConnection()
export const redisRateLimit = createRedisRateLimiterConnection()
export const redisQueue = createRedisBullMQConnection()

export async function closeAllRedisConnections() {
  await Promise.all([
    redisCache.quit(),
    redisRateLimit.quit(),
    redisQueue.quit(),
  ])
}
