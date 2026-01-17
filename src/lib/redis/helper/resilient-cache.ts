import crypto from 'crypto'
import { Redis } from 'ioredis'
import { logger } from '@lib/logger'
import { ServiceOverloadError } from '../errors/service-overload-error'
import { TimeoutExceedOnFetchError } from '../errors/timeout-exceed-on-fetch-error'

export interface ResilientCacheOptions {
  prefix: string
  defaultTtlSeconds: number
  negativeTtlSeconds: number
  maxPendingFetches?: number
  fetchTimeoutMs?: number
  ttlJitterPercentage?: number
}

export class ResilientCache {
  // Intra-pod deduplication map
  private readonly pendingFetches = new Map<string, Promise<any>>()

  private readonly MAX_PENDING: number
  private readonly FETCH_TIMEOUT: number
  private readonly JITTER_PERCENTAGE: number

  constructor(
    private readonly redis: Redis,
    private readonly options: ResilientCacheOptions,
  ) {
    this.MAX_PENDING = options.maxPendingFetches ?? 1_000
    this.FETCH_TIMEOUT = options.fetchTimeoutMs ?? 12_000
    this.JITTER_PERCENTAGE = options.ttlJitterPercentage ?? 0.05
  }

  /* ------------------------------------------------------------------------ */
  /* Key Generation (SHA-256 Hash)                                             */
  /* ------------------------------------------------------------------------ */

  generateKey(params: Record<string, any>): string {
    const stableString = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort()
      .map((k) => `${k}:${String(params[k])}`)
      .join('|')

    const hash = crypto.createHash('sha256').update(stableString).digest('hex')

    return `${this.options.prefix}${hash}`
  }

  /* ------------------------------------------------------------------------ */
  /* Core: Get Or Fetch with Dedup + Abort Coordination                        */
  /* ------------------------------------------------------------------------ */

  async getOrFetch<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T | null> {
    // 1. Intra-pod Deduplication (FAST PATH)
    const existing = this.pendingFetches.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    // 2. Fast Redis Read
    try {
      const cached = await this.redis.get(key)
      if (cached) {
        return JSON.parse(cached) as T
      }
    } catch (err) {
      logger.warn({ err, key }, 'Redis read failed (ResilientCache). Proceeding to fetch.')
    }

    // 3. Circuit Breaker / Overload Protection
    if (this.pendingFetches.size >= this.MAX_PENDING) {
      logger.error({ key }, 'ResilientCache overloaded (MAX_PENDING reached)')
      throw new ServiceOverloadError()
    }

    // 4. Execute fetch with coordinated abort signals
    const promise = this.executeFetchWithSignalLogic(key, fetcher, parentSignal)

    this.pendingFetches.set(key, promise)

    try {
      return await promise
    } finally {
      this.pendingFetches.delete(key)
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Signal Logic with AbortSignal.any()                                       */
  /* ------------------------------------------------------------------------ */

  private async executeFetchWithSignalLogic<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T | null> {
    const timeoutSignal = AbortSignal.timeout(this.FETCH_TIMEOUT)

    const signals: AbortSignal[] = [timeoutSignal]
    if (parentSignal) {
      signals.push(parentSignal)
    }

    const effectiveSignal = AbortSignal.any(signals)

    // Defensive: never start if already aborted
    if (effectiveSignal.aborted) {
      throw this.normalizeAbortReason(effectiveSignal.reason)
    }

    try {
      const result = await fetcher(effectiveSignal)

      // Enforce contract: fetchers must honor AbortSignal
      if (effectiveSignal.aborted) {
        throw this.normalizeAbortReason(effectiveSignal.reason)
      }

      await this.setResult(key, result)
      return result
    } catch (error) {
      if (effectiveSignal.aborted) {
        // Priority 1: Parent abort (user / global timeout)
        if (parentSignal?.aborted) {
          throw this.normalizeAbortReason(parentSignal.reason)
        }

        // Priority 2: Local fetch timeout
        throw new TimeoutExceedOnFetchError()
      }

      throw error
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Abort Reason Normalization                                                */
  /* ------------------------------------------------------------------------ */

  private normalizeAbortReason(reason: unknown): Error {
    if (reason instanceof Error) {
      return reason
    }

    if (typeof reason === 'string') {
      return new Error(reason)
    }

    return new Error('Operation aborted')
  }

  /* ------------------------------------------------------------------------ */
  /* Redis Write                                                              */
  /* ------------------------------------------------------------------------ */

  private async setResult(key: string, result: any): Promise<void> {
    const baseTtl = result === null ? this.options.negativeTtlSeconds : this.options.defaultTtlSeconds

    try {
      const jitterAmount = Math.floor(baseTtl * this.JITTER_PERCENTAGE)
      const randomOffset = Math.floor(Math.random() * (jitterAmount * 2 + 1)) - jitterAmount

      const finalTtl = Math.max(1, baseTtl + randomOffset)

      await this.redis.set(key, JSON.stringify(result), 'EX', finalTtl)
    } catch (err) {
      logger.error({ err, key }, 'Failed to write to Redis (ResilientCache)')
    }
  }
}