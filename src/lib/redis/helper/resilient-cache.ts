import crypto from 'crypto'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'

export interface ResilientCacheOptions {
  prefix: string
  defaultTtlSeconds: number
  negativeTtlSeconds: number
  lockTtlMs?: number
  maxWaitTimeMs?: number
}

export class ResilientCache {
  private readonly LOCK_TTL_MS: number
  private readonly MAX_WAIT_TIME_MS: number
  private subClient: Redis | null = null
  // [FIX] In-memory map to coalesce concurrent fetches for the same key
  private readonly pendingFetches = new Map<string, Promise<any>>()

  constructor(
    private readonly redis: Redis,
    private readonly options: ResilientCacheOptions,
  ) {
    this.LOCK_TTL_MS = options.lockTtlMs || 10_000
    this.MAX_WAIT_TIME_MS = options.maxWaitTimeMs || 10_000
  }

  generateKey(params: Record<string, any>): string {
    const cleanedParams = Object.keys(params)
      .filter((key) => {
        const value = params[key]
        return value !== undefined && value !== null && value !== ''
      })
      .sort()
      .reduce(
        (obj, key) => {
          obj[key] = params[key]
          return obj
        },
        {} as Record<string, any>,
      )

    const str = JSON.stringify(cleanedParams)
    const hash = crypto.createHash('sha256').update(str).digest('hex')
    return `${this.options.prefix}${hash}`
  }

  /**
   * Main entry point with In-Memory Request Coalescing.
   * This prevents cache stampedes even if Redis is completely down.
   */
  async getOrFetch<T>(cacheKey: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    // [FIX] Check in-memory pending fetches first
    if (this.pendingFetches.has(cacheKey)) {
      logger.debug({ cacheKey }, 'Joining in-flight fetch (Request Coalescing)')
      return this.pendingFetches.get(cacheKey) as Promise<T | null>
    }

    const promise = this.executeGetOrFetch(cacheKey, fetcher)

    // Store the promise in memory so others can join
    this.pendingFetches.set(cacheKey, promise)

    try {
      return await promise
    } finally {
      // Clean up memory map after completion
      this.pendingFetches.delete(cacheKey)
    }
  }

  private async executeGetOrFetch<T>(cacheKey: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    // 1. Try Cache First
    let redisHealthy = true
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached !== null) {
        const parsed = this.parseCache<T>(cached, cacheKey)
        if (parsed !== undefined) {
          const isNegativeCache = parsed === null
          logger.info(
            { cacheKey, isNegativeCache },
            `✓ Cache HIT - ${isNegativeCache ? 'Negative cache' : 'Data cached'}`,
          )
          return parsed
        }
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Redis unavailable - bypassing cache')
      redisHealthy = false
    }

    // [FIX] If Redis is down, we proceed to fetcher, but now we are protected
    // by the pendingFetches map in the wrapper function, preventing a stampede.
    if (!redisHealthy) {
      return fetcher()
    }

    // 2. Acquire Distributed Lock
    const lockKey = `${cacheKey}:lock`
    const lockToken = crypto.randomBytes(16).toString('hex')
    const lockAcquired = await this.acquireLock(lockKey, lockToken)

    if (!lockAcquired) {
      return this.waitForCacheOrFallback(cacheKey, lockKey, fetcher)
    }

    try {
      // 3. Double-check cache (Double-Checked Locking)
      try {
        const recheck = await this.redis.get(cacheKey)
        if (recheck !== null) {
          const parsed = this.parseCache<T>(recheck, cacheKey)
          if (parsed !== undefined) {
            const isNegativeCache = parsed === null
            logger.info(
              { cacheKey, isNegativeCache },
              `✓ Cache HIT (double-check) - ${isNegativeCache ? 'Negative cache' : 'Data cached'}`,
            )
            return parsed
          }
        }
      } catch (err) {
        logger.warn({ err, cacheKey }, 'Redis error during double-check')
      }

      // 4. Execute Fetcher
      const result = await fetcher()

      // 5. Save to Cache
      await this.saveToCache(cacheKey, result)

      return result
    } finally {
      // 6. Release Lock & Notify Waiters
      await this.releaseLock(lockKey, lockToken)
    }
  }

  private parseCache<T>(cached: string, cacheKey: string): T | null | undefined {
    try {
      return JSON.parse(cached)
    } catch (parseError) {
      logger.warn({ err: parseError, cacheKey }, 'Invalid JSON in cache, ignoring')
      return undefined
    }
  }

  private async acquireLock(lockKey: string, token: string): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, token, 'PX', this.LOCK_TTL_MS, 'NX')
      return result === 'OK'
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis error acquiring lock - proceeding degraded')
      return true
    }
  }

  private async releaseLock(lockKey: string, token: string): Promise<void> {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          local del = redis.call("del", KEYS[1])
          redis.call("publish", KEYS[2], "released")
          return del
        else
          return 0
        end
      `
      const channel = `${lockKey}:released`
      await this.redis.eval(script, 2, lockKey, channel, token)
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis error releasing lock')
    }
  }

  private async waitForCacheOrFallback<T>(
    cacheKey: string,
    lockKey: string,
    fetcher: () => Promise<T | null>,
  ): Promise<T | null> {
    const channel = `${lockKey}:released`
    const start = Date.now()
    const sub = this.getSubscriber()

    try {
      await sub.subscribe(channel)
    } catch (err) {
      logger.warn({ err }, 'Failed to subscribe to lock channel, falling back to polling')
    }

    while (Date.now() - start < this.MAX_WAIT_TIME_MS) {
      try {
        const lockExists = await this.redis.exists(lockKey)
        if (lockExists === 0) {
          const cached = await this.redis.get(cacheKey)
          if (cached !== null) {
            const parsed = this.parseCache<T>(cached, cacheKey)
            if (parsed !== undefined) {
              const isNegativeCache = parsed === null
              const waitTime = Date.now() - start
              logger.info(
                { cacheKey, isNegativeCache, waitTimeMs: waitTime },
                `✓ Cache HIT (after wait) - ${isNegativeCache ? 'Negative cache' : 'Data cached'}`,
              )
              return parsed
            }
          }

          const fallbackResult = await this.tryAcquireAndFetch(cacheKey, lockKey, fetcher)
          if (fallbackResult !== undefined) return fallbackResult
        }
      } catch (err) {
        logger.warn({ err }, 'Redis error in wait loop')
        break
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 2000)
        sub.once('message', (ch, msg) => {
          if (ch === channel && msg === 'released') {
            clearTimeout(timeout)
            resolve()
          }
        })
      })
    }

    await sub.unsubscribe(channel).catch(() => {})
    logger.warn({ cacheKey }, 'Lock wait timeout - fetching in degraded mode')
    return fetcher()
  }

  private async tryAcquireAndFetch<T>(
    cacheKey: string,
    lockKey: string,
    fetcher: () => Promise<T | null>,
  ): Promise<T | null | undefined> {
    const lockToken = crypto.randomBytes(16).toString('hex')
    try {
      const result = await this.redis.set(lockKey, lockToken, 'PX', this.LOCK_TTL_MS, 'NX')
      if (result !== 'OK') return undefined

      try {
        const cached = await this.redis.get(cacheKey)
        if (cached !== null) {
          const parsed = this.parseCache<T>(cached, cacheKey)
          if (parsed !== undefined) {
            const isNegativeCache = parsed === null
            logger.info(
              { cacheKey, isNegativeCache },
              `✓ Cache HIT (fallback) - ${isNegativeCache ? 'Negative cache' : 'Data cached'}`,
            )
            return parsed
          }
        }

        const res = await fetcher()
        await this.saveToCache(cacheKey, res)
        return res
      } finally {
        await this.releaseLock(lockKey, lockToken)
      }
    } catch {
      return undefined
    }
  }

  private async saveToCache<T>(cacheKey: string, result: T | null): Promise<void> {
    try {
      const isNegativeCache = result === null
      const ttl = isNegativeCache ? this.options.negativeTtlSeconds : this.options.defaultTtlSeconds

      logger.debug(
        { cacheKey, isNegativeCache, ttl },
        `Caching ${isNegativeCache ? 'negative result' : 'result'} with ${Math.round(ttl / 86400)}d TTL`,
      )

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttl)
    } catch (err) {
      logger.error({ err, cacheKey }, 'Redis error writing cache')
    }
  }

  private getSubscriber(): Redis {
    if (!this.subClient) {
      this.subClient = this.redis.duplicate()
      this.subClient.on('error', (err) => logger.error({ err }, 'Redis Subscriber Error'))
    }
    return this.subClient
  }
}
