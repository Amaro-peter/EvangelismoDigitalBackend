import { createRedisBullMQConnection } from '../connections/redis-bullMQ-connection'
import { createRedisCacheConnection } from '../connections/redis-cache-connection'
import { createRedisRateLimiterConnection } from '../connections/redis-rate-limiter-connection'

// Instâncias Singleton (Lazy loading opcional)
export const redisCache = createRedisCacheConnection()
export const redisRateLimit = createRedisRateLimiterConnection()
export const redisForQueue = createRedisBullMQConnection()

export function createWorkerConnection() {
  return createRedisBullMQConnection()
}

export async function closeAllRedisConnections() {
  await Promise.all([redisCache.quit(), redisRateLimit.quit(), redisForQueue.quit()])
}
