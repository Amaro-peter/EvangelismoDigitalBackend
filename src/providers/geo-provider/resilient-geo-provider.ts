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
  private readonly LOCK_RETRY_DELAY_MS = 50
  private readonly LOCK_MAX_RETRIES = 200 // Total: 10s max wait

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
    // 1. Try Cache First + Test Redis Health
    let redisHealthy = true
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached !== null) {
        const parsed = this.parseCache(cached, cacheKey)
        if (parsed !== undefined) {
          logger.debug({ cacheKey }, 'Cache hit for geocoding query')
          return parsed
        }
        // If undefined, cache was corrupt - proceed to fetch
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Redis unavailable - bypassing cache and locking entirely')
      redisHealthy = false
    }

    // If Redis is down, skip all Redis operations and go straight to providers
    if (!redisHealthy) {
      return this.executeStrategy(action)
    }

    // 2. Acquire Distributed Lock (Prevents Race Condition)
    const lockKey = `${cacheKey}:lock`
    const lockToken = crypto.randomBytes(16).toString('hex')
    const lockAcquired = await this.acquireLock(lockKey, lockToken)

    if (!lockAcquired) {
      // Another instance is fetching this data
      // Wait for it to complete and retry cache
      return this.waitForCacheOrFallback(cacheKey, lockKey, action)
    }

    try {
      // 3. Double-check cache (another instance might have populated it)
      try {
        const recheck = await this.redis.get(cacheKey)
        if (recheck !== null) {
          const parsed = this.parseCache(recheck, cacheKey)
          if (parsed !== undefined) {
            logger.debug({ cacheKey }, 'Cache populated while acquiring lock')
            return parsed
          }
          // Corrupted cache found - will fetch fresh data below
        }
      } catch (err) {
        logger.warn({ err, cacheKey }, 'Redis error during double-check, proceeding to fetch')
      }

      // 4. Execute Provider Strategy
      const result = await this.executeStrategy(action)

      // 5. Save to Cache (even if null to prevent repeated lookups)
      await this.saveToCache(cacheKey, result)

      return result
    } finally {
      // 6. Release Lock
      await this.releaseLock(lockKey, lockToken)
    }
  }

  private parseCache(cached: string, cacheKey: string): GeoCoordinates | null | undefined {
    try {
      return JSON.parse(cached)
    } catch (parseError) {
      logger.warn({ err: parseError, cacheKey }, 'Invalid JSON in cache, ignoring')
      // Return undefined to signal cache corruption (not the same as cached null)
      return undefined
    }
  }

  private async acquireLock(lockKey: string, token: string): Promise<boolean> {
    try {
      // SET key value PX milliseconds NX (only if key doesn't exist)
      const result = await this.redis.set(lockKey, token, 'PX', this.LOCK_TTL_MS, 'NX')
      return result === 'OK'
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis error acquiring lock - proceeding without lock (degraded mode)')
      return true // Fail-open: proceed AS IF lock was acquired (degraded mode)
    }
  }

  private async releaseLock(lockKey: string, token: string): Promise<void> {
    try {
      // Lua script ensures atomic check-and-delete
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
      await this.redis.eval(script, 1, lockKey, token)
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis error releasing lock')
    }
  }

  private async waitForCacheOrFallback(
    cacheKey: string,
    lockKey: string,
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null> {
    // Wait for the lock holder to populate cache
    for (let i = 0; i < this.LOCK_MAX_RETRIES; i++) {
      await this.sleep(this.LOCK_RETRY_DELAY_MS)

      try {
        // Check if lock was released (means other instance finished)
        const lockExists = await this.redis.exists(lockKey)
        if (lockExists === 0) {
          // Lock released, check cache first
          const cached = await this.redis.get(cacheKey)
          if (cached !== null) {
            const parsed = this.parseCache(cached, cacheKey)
            if (parsed !== undefined) {
              logger.debug({ cacheKey, retries: i + 1 }, 'Cache populated by another instance')
              return parsed
            }
          }

          // Lock released but no cache = try to acquire lock ourselves
          // This prevents thundering herd when multiple waiters timeout simultaneously
          const fallbackResult = await this.tryAcquireAndFetch(cacheKey, lockKey, action)
          if (fallbackResult !== undefined) {
            return fallbackResult
          }
          // Couldn't acquire lock, another waiter got it - continue waiting
        }
      } catch (err) {
        logger.warn({ err, cacheKey }, 'Redis error while waiting for cache - proceeding to degraded fetch')
        // Redis failed during wait, proceed in degraded mode (no lock)
        return this.executeStrategy(action)
      }
    }

    // Timeout: Try one more time to acquire lock before giving up
    logger.warn({ cacheKey }, 'Lock wait timeout - attempting final lock acquisition')
    const finalResult = await this.tryAcquireAndFetch(cacheKey, lockKey, action)
    if (finalResult !== undefined) {
      return finalResult
    }

    // Absolute fallback: Fetch without lock (degraded mode)
    // This should be rare - only when lock is perpetually held
    logger.warn({ cacheKey }, 'Could not acquire lock after timeout - fetching in degraded mode')
    return this.executeStrategy(action)
  }

  /**
   * Attempts to acquire lock and fetch data. Returns undefined if lock wasn't acquired.
   * This prevents thundering herd by ensuring only one waiter proceeds to fetch.
   */
  private async tryAcquireAndFetch(
    cacheKey: string,
    lockKey: string,
    action: (provider: GeocodingProvider) => Promise<GeoCoordinates | null>,
  ): Promise<GeoCoordinates | null | undefined> {
    const lockToken = crypto.randomBytes(16).toString('hex')

    try {
      const acquired = await this.acquireLockStrict(lockKey, lockToken)
      if (!acquired) {
        // Another waiter got the lock first - return undefined to signal "keep waiting"
        return undefined
      }

      try {
        // Double-check cache (another instance might have just populated it)
        const cached = await this.redis.get(cacheKey)
        if (cached !== null) {
          const parsed = this.parseCache(cached, cacheKey)
          if (parsed !== undefined) {
            logger.debug({ cacheKey }, 'Cache populated while acquiring fallback lock')
            return parsed
          }
        }

        // Fetch from providers
        const result = await this.executeStrategy(action)
        await this.saveToCache(cacheKey, result)
        return result
      } finally {
        await this.releaseLock(lockKey, lockToken)
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Error in tryAcquireAndFetch')
      // Return undefined to signal failure, let caller decide
      return undefined
    }
  }

  /**
   * Strict lock acquisition - does NOT fail-open on Redis errors.
   * Used for fallback path where we want to prevent thundering herd.
   */
  private async acquireLockStrict(lockKey: string, token: string): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, token, 'PX', this.LOCK_TTL_MS, 'NX')
      return result === 'OK'
    } catch (err) {
      logger.warn({ err, lockKey }, 'Redis error in strict lock acquisition')
      return false // Fail-closed: don't proceed without lock
    }
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
