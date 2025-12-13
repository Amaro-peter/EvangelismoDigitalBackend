import { env } from '@env/index'
import Redis from 'ioredis'

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
})

redisConnection.on('connect', () => {
  console.log('✅ Redis connected successfully')
})

redisConnection.on('error', (error) => {
  console.error('❌ Redis connection error:', error)
})

redisConnection.on('ready', () => {
  console.log('✅ Redis is ready to accept commands')
})
