import { env } from '@env/index'
import IORedis from 'ioredis'

export const redisConnection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
})