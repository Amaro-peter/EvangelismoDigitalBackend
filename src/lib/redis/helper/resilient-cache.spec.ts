vi.mock('../../env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'http://localhost',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    APP_NAME: 'Test',
    APP_PORT: 3000,
    JWT_SECRET: 'x'.repeat(60),
    FRONTEND_URL: 'http://localhost:5173',
    HASH_SALT_ROUNDS: 12,
    SMTP_EMAIL: 'test@example.com',
    SMTP_PASSWORD: 'test',
    SMTP_PORT: 465,
    SMTP_HOST: 'smtp.test.com',
    SMTP_SECURE: true,
    ADMIN_EMAIL: 'admin@example.com',
    AWESOME_API_URL: 'http://awesomeapi.test',
    AWESOME_API_TOKEN: 'token',
    VIACEP_API_URL: 'http://viacep.test',
    NOMINATIM_API_URL: 'http://nominatim.test',
    LOCATION_IQ_API_URL: 'http://locationiq.test',
    LOCATION_IQ_API_TOKEN: 'token',
    SENTRY_DSN: '',
  },
}))

vi.mock('../../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResilientCache, ResilientCacheOptions } from './resilient-cache'

function createMockRedis() {
  let store: Record<string, string> = {}
  return {
    get: vi.fn((key: string) => Promise.resolve(store[key] ?? null)),
    set: vi.fn((key: string, value: string, _ex: string, _ttl: number) => {
      store[key] = value
      return Promise.resolve('OK')
    }),
    clear: () => {
      store = {}
    },
  }
}

const defaultOptions: ResilientCacheOptions = {
  prefix: 'test:',
  defaultTtlSeconds: 100,
  negativeTtlSeconds: 10,
  maxPendingFetches: 2,
  fetchTimeoutMs: 100,
  ttlJitterPercentage: 0.1,
}

describe('ResilientCache', () => {
  let redis: ReturnType<typeof createMockRedis>
  let cache: ResilientCache
  let mockLogger: any

  beforeEach(async () => {
    redis = createMockRedis()
    cache = new ResilientCache(redis as any, defaultOptions)

    // Get the mocked logger inside beforeEach using relative path
    const loggerModule = await import('../../logger/index.js')
    mockLogger = loggerModule.logger

    vi.clearAllMocks()
    redis.clear()
  })

  it('should generate a stable cache key', () => {
    const key1 = cache.generateKey({ a: 1, b: 2 })
    const key2 = cache.generateKey({ b: 2, a: 1 })
    expect(key1).toBe(key2)
    expect(key1.startsWith(defaultOptions.prefix)).toBe(true)
  })

  it('should return cached value if present', async () => {
    const cacheKey = 'test:abc'
    await redis.set(cacheKey, JSON.stringify({ foo: 'bar' }), 'EX', 100)
    const result = await cache.getOrFetch(cacheKey, async () => ({ foo: 'baz' }))
    expect(result).toEqual({ foo: 'bar' })
    expect(redis.get).toHaveBeenCalledWith(cacheKey)
    expect(mockLogger.info).toHaveBeenCalledWith({ cacheKey }, '✓ Cache HIT - Dados recuperados do Redis')
  })

  it('should fetch and cache if not present', async () => {
    const cacheKey = 'test:miss'
    const fetcher = vi.fn().mockResolvedValue({ hello: 'world' })
    const result = await cache.getOrFetch(cacheKey, fetcher)
    expect(result).toEqual({ hello: 'world' })
    expect(fetcher).toHaveBeenCalled()
    expect(redis.set).toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith({ cacheKey }, '✗ Cache MISS - Buscando dados da fonte')
  })

  it('should cache null with negativeTtlSeconds', async () => {
    const cacheKey = 'test:null'
    const fetcher = vi.fn().mockResolvedValue(null)
    await cache.getOrFetch(cacheKey, fetcher)
    const setCall = redis.set.mock.calls[0]
    expect(setCall[0]).toBe(cacheKey)
    expect(JSON.parse(setCall[1])).toBe(null)
    expect(setCall[3]).toBeGreaterThanOrEqual(1)
    expect(setCall[3]).toBeLessThanOrEqual(defaultOptions.negativeTtlSeconds * 1.1)
  })

  it('should deduplicate concurrent fetches', async () => {
    const cacheKey = 'test:dedup'
    let callCount = 0
    const fetcher = async () => {
      callCount++
      await new Promise((r) => setTimeout(r, 10))
      return { v: callCount }
    }
    const [r1, r2] = await Promise.all([cache.getOrFetch(cacheKey, fetcher), cache.getOrFetch(cacheKey, fetcher)])
    expect(r1).toEqual(r2)
    expect(callCount).toBe(1)
    expect(mockLogger.debug).toHaveBeenCalledWith({ cacheKey }, 'Requisição coalescida - reutilizando fetch pendente')
  })

  it('should handle memory pressure and throw', async () => {
    const cacheKey1 = 'test:1'
    const cacheKey2 = 'test:2'
    const cacheKey3 = 'test:3'
    const fetcher = async () => new Promise((r) => setTimeout(() => r('x'), 50))
    cache.getOrFetch(cacheKey1, fetcher)
    cache.getOrFetch(cacheKey2, fetcher)
    await expect(cache.getOrFetch(cacheKey3, fetcher)).rejects.toThrow('Serviço sobrecarregado')
    expect(mockLogger.warn).toHaveBeenCalledWith({ cacheKey: cacheKey3 }, 'Pressão de memória: descartando requisição')
  })

  it('should clean up pendingFetches after completion', async () => {
    const cacheKey = 'test:cleanup'
    const fetcher = vi.fn().mockResolvedValue('done')
    await cache.getOrFetch(cacheKey, fetcher)
    expect(cache.getPendingCount()).toBe(0)
  })

  it('should abort fetcher on timeout', async () => {
    const cacheKey = 'test:timeout'
    let aborted = false
    const fetcher = (signal: AbortSignal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    await expect(cache.getOrFetch(cacheKey, fetcher)).rejects.toThrow('Timeout estourado')
    expect(aborted).toBe(true)
  })

  it('should not cache if fetcher is aborted', async () => {
    const cacheKey = 'test:abort'
    const fetcher = (signal: AbortSignal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    await expect(cache.getOrFetch(cacheKey, fetcher)).rejects.toThrow('Timeout estourado')
    expect(redis.set).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith({ cacheKey }, 'Fetch abortado - Pulando escrita no cache')
  })

  it('should handle redis.get error gracefully', async () => {
    redis.get.mockRejectedValueOnce(new Error('redis down'))
    const cacheKey = 'test:rediserr'
    const fetcher = vi.fn().mockResolvedValue('fallback')
    const result = await cache.getOrFetch(cacheKey, fetcher)
    expect(result).toBe('fallback')
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), cacheKey }),
      'Falha no Redis - Continuando sem cache',
    )
  })

  it('should handle redis.set error gracefully', async () => {
    redis.set.mockRejectedValueOnce(new Error('redis set fail'))
    const cacheKey = 'test:seterr'
    const fetcher = vi.fn().mockResolvedValue('val')
    await cache.getOrFetch(cacheKey, fetcher)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), cacheKey }),
      'Falha ao escrever no cache',
    )
  })

  it('should not cache undefined results', async () => {
    const cacheKey = 'test:undefined'
    const fetcher = vi.fn().mockResolvedValue(undefined)
    await cache.getOrFetch(cacheKey, fetcher)
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('isUnderMemoryPressure returns true when >= 80% of max', async () => {
    const fetcher = async () => new Promise((r) => setTimeout(() => r('x'), 50))
    cache.getOrFetch('test:1', fetcher)
    cache.getOrFetch('test:2', fetcher)
    expect(cache.isUnderMemoryPressure()).toBe(true)
  })
})
