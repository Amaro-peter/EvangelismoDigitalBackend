import { PrismaClient } from '@prisma/client'
import { env } from '@env/index'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

/**
 * Prisma Client Singleton
 *
 * Connection pool configured via DATABASE_URL:
 * - connection_limit: 10 (max concurrent connections)
 * - pool_timeout: 10s (wait time for available connection)
 * - connect_timeout: 10s (new connection timeout)
 *
 * These settings are optimized for the current Docker setup:
 * - 512MB RAM limit per container
 * - Rate limit of 20 req/min for church-finding endpoints
 * - Supports ~100 concurrent requests comfortably
 */

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
})

const adapter: unknown = new PrismaPg(pool)

export const prisma = new PrismaClient({
  adapter,
  log: env.LOG_LEVEL === 'debug' ? ['query', 'info', 'warn'] : [],
})
