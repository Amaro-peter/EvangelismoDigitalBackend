import crypto from 'crypto'
import { Redis } from 'ioredis'
import { GeocodingProvider, GeoCoordinates, GeoSearchOptions } from './geo-provider.interface'
import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'

export class ResilientGeoProvider implements GeocodingProvider {
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days
  private readonly NEGATIVE_CACHE_TTL_SECONDS = 60 * 60 // 1 hour for null results
  private readonly CACHE_PREFIX = 'cache:geocoding:'
  private readonly LOCK_TTL_MS = 10_000 // 10 seconds
  private readonly MAX_WAIT_TIME_MS = 10_000 // Total max wait time

  // Lazy-loaded subscriber client for Pub/Sub events
  private subClient: Redis | null = null

  constructor(
    private readonly providers: GeocodingProvider[],
    private readonly redis: Redis,
  ) {
    if (this.providers.length === 0) {
      throw new Error('ResilientGeoProvider requires at least one provider')
    }
  }

  async search(query: string): Promise<GeoCoordinates | null> {
    const cacheKey = this.generateCacheKey({ _method: 'search', q: query })
    return this.executeWithCache(cacheKey, (provider) => provider.search(query))
  }

  async searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null> {
    const cacheKey = this.generateCacheKey({ _method: 'searchStructured', ...options })
    return this.executeWithCache(cacheKey, (provider) => provider.searchStructured(options))
  }

  private async executeWithCache(
    cacheKey: string,
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    // 1. Try Cache First
    let redisHealthy = true
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached !== null) {
        const parsed = this.parseCache(cached, cacheKey)
        if (parsed !== undefined) {
          logger.debug({ cacheKey }, 'Cache hit for geocoding query')
          return parsed
        }
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Redis unavailable - bypassing cache')
      redisHealthy = false
    }

    if (!redisHealthy) {
      return this.executeStrategy(action)
    }

    // 2. Acquire Distributed Lock (Prevents Race Condition)
    const lockKey = `${cacheKey}:lock`
    const lockToken = crypto.randomBytes(16).toString('hex')
    const lockAcquired = await this.acquireLock(lockKey, lockToken)

    if (!lockAcquired) {
      // Wait for the lock holder to finish (Event-Driven)
      return this.waitForCacheOrFallback(cacheKey, lockKey, action)
    }

    try {
      // 3. Double-check cache
      try {
        const recheck = await this.redis.get(cacheKey)
        if (recheck !== null) {
          const parsed = this.parseCache(recheck, cacheKey)
          if (parsed !== undefined) {
            logger.debug({ cacheKey }, 'Cache populated while acquiring lock')
            return parsed
          }
        }
      } catch (err) {
        logger.warn({ err, cacheKey }, 'Redis error during double-check')
      }

      // 4. Execute Provider Strategy
      const result = await this.executeStrategy(action)

      // 5. Save to Cache
      await this.saveToCache(cacheKey, result)

      return result
    } finally {
      // 6. Release Lock & Notify Waiters
      await this.releaseLock(lockKey, lockToken)
    }
  }

  private parseCache(cached: string, cacheKey: string): GeoCoordinates | null | undefined {
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
      // Lua script: Deletes lock AND publishes release event atomically
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

  /**
   * Optimized: Uses Pub/Sub to wait instead of sleep-polling
   */
  private async waitForCacheOrFallback(
    cacheKey: string,
    lockKey: string,
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    const channel = `${lockKey}:released`
    const start = Date.now()

    // Ensure we have a subscriber client
    const sub = this.getSubscriber()

    // Subscribe immediately to catch any upcoming release events
    try {
      await sub.subscribe(channel)
    } catch (err) {
      logger.warn({ err }, 'Failed to subscribe to lock channel, falling back to polling')
    }

    while (Date.now() - start < this.MAX_WAIT_TIME_MS) {
      // 1. Check if lock is gone (or cache populated)
      try {
        const lockExists = await this.redis.exists(lockKey)
        if (lockExists === 0) {
          // Lock released! Check cache.
          const cached = await this.redis.get(cacheKey)
          if (cached !== null) {
            const parsed = this.parseCache(cached, cacheKey)
            if (parsed !== undefined) return parsed
          }

          // No cache? Try to acquire lock ourselves
          const fallbackResult = await this.tryAcquireAndFetch(cacheKey, lockKey, action)
          if (fallbackResult !== undefined) return fallbackResult
        }
      } catch (err) {
        logger.warn({ err }, 'Redis error in wait loop')
        break // Fail to degraded mode
      }

      // 2. Wait for Notification (Event-driven sleep)
      // We wait for the 'message' event OR a timeout (fallback polling interval)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 2000) // 2s fallback heartbeat

        sub.once('message', (ch, msg) => {
          if (ch === channel && msg === 'released') {
            clearTimeout(timeout)
            resolve()
          }
        })
      })
    }

    // Cleanup subscription for this key (optional but good practice to unsubscribe if not using pattern)
    // Note: In high throughput, pattern matching or global listener is better, but this is safe logic.
    await sub.unsubscribe(channel).catch(() => {})

    // Timeout or Error: Fallback
    logger.warn({ cacheKey }, 'Lock wait timeout - fetching in degraded mode')
    return this.executeStrategy(action)
  }

  private async tryAcquireAndFetch(
    cacheKey: string,
    lockKey: string,
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null | undefined> {
    const lockToken = crypto.randomBytes(16).toString('hex')
    try {
      // Strict lock acquisition
      const result = await this.redis.set(lockKey, lockToken, 'PX', this.LOCK_TTL_MS, 'NX')
      if (result !== 'OK') return undefined

      try {
        // Check cache one last time
        const cached = await this.redis.get(cacheKey)
        if (cached !== null) {
          const parsed = this.parseCache(cached, cacheKey)
          if (parsed !== undefined) return parsed
        }

        const res = await this.executeStrategy(action)
        await this.saveToCache(cacheKey, res)
        return res
      } finally {
        await this.releaseLock(lockKey, lockToken)
      }
    } catch {
      return undefined
    }
  }

  private getSubscriber(): Redis {
    if (!this.subClient) {
      // Create a dedicated connection for subscriptions
      // This prevents blocking the main client and allows Pub/Sub
      this.subClient = this.redis.duplicate()
      this.subClient.on('error', (err) => logger.error({ err }, 'Redis Subscriber Error'))
    }
    return this.subClient
  }

  private async executeStrategy(
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    let lastError: unknown = null

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name
      const isLastProvider = index === this.providers.length - 1

      try {
        const result = await action(provider)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocoding successful')
          return result
        }

        if (!isLastProvider) {
          logger.warn({ provider: providerName }, 'Provider returned no results, trying fallback...')
        } else {
          logger.warn({ provider: providerName }, 'Last provider returned no results')
        }
      } catch (error) {
        lastError = error

        if (error instanceof GeoServiceBusyError) {
          logger.warn(
            { provider: providerName, attempt: index + 1 },
            'Provider is busy (Rate Limit). Switching to fallback...',
          )
        } else {
          logger.warn(
            { provider: providerName, error: (error as Error).message },
            'Provider failed. Switching to fallback...',
          )
        }

        if (isLastProvider) {
          logger.error({ lastError }, 'All geocoding providers failed with errors')
          throw lastError
        }
      }
    }

    logger.warn('All geocoding providers returned no results')
    return null
  }

  private async saveToCache(cacheKey: string, result: GeoCoordinates | null): Promise<void> {
    try {
      const ttl = result === null ? this.NEGATIVE_CACHE_TTL_SECONDS : this.CACHE_TTL_SECONDS
      const ttlLabel = result === null ? '1h' : '90d'

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttl)

      logger.debug({ cacheKey, isNegativeCache: result === null, ttl }, `Cached geocoding result (${ttlLabel} TTL)`)
    } catch (err) {
      logger.error({ err, cacheKey }, 'Redis error writing geocoding cache')
    }
  }

  private generateCacheKey(params: Record<string, any>): string {
    // Filter out undefined/null/empty values for consistent hashing
    // BUT preserve _method which is critical for cache isolation
    const cleanedParams = Object.keys(params)
      .filter((key) => {
        if (key === '_method') return true // Always include method
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
    return `${this.CACHE_PREFIX}${hash}`
  }
}
