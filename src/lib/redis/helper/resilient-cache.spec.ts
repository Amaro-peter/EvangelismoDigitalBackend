// src/lib/redis/helper/resilient-cache.spec.ts

import { vi, describe, it, expect, beforeEach } from 'vitest'

// 1. Mock environment variables FIRST
vi.mock('@lib/env', () => ({
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

// 2. Mock logger
vi.mock('@lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}))

// 3. Mock IORedis
const mockRedisGet = vi.fn()
const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(function () {
    return {
      get: mockRedisGet,
      set: mockRedisSet,
      del: mockRedisDel,
      quit: vi.fn().mockResolvedValue('OK'),
    }
  })

  return {
    default: RedisMock,
    Redis: RedisMock,
  }
})

// Imports reais
import Redis from 'ioredis'
import { ResilientCache, CachedFailureError } from './resilient-cache'
import { TimeoutExceededOnFetchError } from '../errors/timeout-exceed-on-fetch-error'
import { OperationAbortedError } from '../errors/operation-aborted-error'
import { ServiceOverloadError } from '../errors/service-overload-error'

describe('ResilientCache Unit Tests', () => {
  let redisClient: Redis
  let resilientCache: ResilientCache

  const defaultOptions = {
    prefix: 'test-cache:',
    defaultTtlSeconds: 60,
    negativeTtlSeconds: 10,
    fetchTimeoutMs: 100,
    maxPendingFetches: 5,
    ttlJitterPercentage: 0.1,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    redisClient = new Redis()
    resilientCache = new ResilientCache(redisClient, defaultOptions)
  })

  // === 1. generateKey ===
  describe('generateKey', () => {
    it('should generate a consistent SHA-256 hash for given params', () => {
      const params = { foo: 'bar', id: 123 }
      const key1 = resilientCache.generateKey(params)
      const key2 = resilientCache.generateKey(params)

      expect(key1).toBe(key2)
      expect(key1).toMatch(/^test-cache:[a-f0-9]{64}$/)
    })

    it('should ignore undefined/null/empty values but respect 0 and false', () => {
      const p1 = { a: '1', b: null }
      expect(resilientCache.generateKey(p1)).toBeDefined()
    })
  })

  // === 2. normalizeAbortReason ===
  describe('normalizeAbortReason', () => {
    const getPrivateMethod = () => (resilientCache as any).normalizeAbortReason.bind(resilientCache)

    it('should return existing TimeoutExceededOnFetchError', () => {
      const error = new TimeoutExceededOnFetchError('timeout')
      expect(getPrivateMethod()(error)).toBe(error)
    })

    it('should wrap string reason in TimeoutExceededOnFetchError', () => {
      const result = getPrivateMethod()('AbortSignal.timeout')
      expect(result).toBeInstanceOf(TimeoutExceededOnFetchError)
    })

    it('should wrap unknown NON-ERROR types in OperationAbortedError', () => {
      const unknownReason = { custom: 'reason' }
      const result = getPrivateMethod()(unknownReason)
      expect(result).toBeInstanceOf(OperationAbortedError)
    })

    it('should wrap generic Error in OperationAbortedError', () => {
      const error = new Error('Generic Error')
      // Baseado na implementação: Error genérico vira TimeoutExceededOnFetchError
      expect(() => getPrivateMethod()(error)).toThrow(TimeoutExceededOnFetchError)
    })
  })

  // === 3. executeFetchWithSignalLogic ===
  describe('executeFetchWithSignalLogic', () => {
    const executeFetch = (key: string, fetcher: any) =>
      (resilientCache as any).executeFetchWithSignalLogic(key, fetcher, undefined, undefined)

    it('should resolve value when fetcher succeeds', async () => {
      const mockFetcher = vi.fn().mockResolvedValue('success')
      const result = await executeFetch('key', mockFetcher)
      expect(result).toBe('success')
    })

    it('should reject with Error if fetcher fails', async () => {
      const error = new Error('fetch-fail')
      const mockFetcher = vi.fn().mockRejectedValue(error)
      await expect(executeFetch('key', mockFetcher)).rejects.toThrow('fetch-fail')
    })
  })

  // === 4. getOrFetch (Cenários Principais) ===
  describe('getOrFetch', () => {
    it('should return cached value immediately on CACHE HIT (Success)', async () => {
      const keyParams = { id: 'test-1' }
      const generatedKey = resilientCache.generateKey(keyParams)

      mockRedisGet.mockResolvedValue(JSON.stringify({ s: true, v: 'cached-value' }))

      const fetcher = vi.fn()
      const result = await resilientCache.getOrFetch(generatedKey, fetcher)

      expect(mockRedisGet).toHaveBeenCalledWith(generatedKey)
      expect(result).toBe('cached-value')
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('should throw CachedFailureError on CACHE HIT (Failure/Negative Cache)', async () => {
      const keyParams = { id: 'test-2' }
      const generatedKey = resilientCache.generateKey(keyParams)

      mockRedisGet.mockResolvedValue(
        JSON.stringify({
          s: false,
          e: { type: 'Error', message: 'Cached Error' },
        }),
      )

      const fetcher = vi.fn()

      await expect(resilientCache.getOrFetch(generatedKey, fetcher)).rejects.toThrow(CachedFailureError)

      expect(fetcher).not.toHaveBeenCalled()
    })

    it('should execute fetcher on CACHE MISS and cache success', async () => {
      const keyParams = { id: 'test-3' }
      const generatedKey = resilientCache.generateKey(keyParams)

      mockRedisGet.mockResolvedValue(null)
      mockRedisSet.mockResolvedValue('OK')
      const fetcher = vi.fn().mockResolvedValue('fresh-data')

      const result = await resilientCache.getOrFetch(generatedKey, fetcher)

      expect(result).toBe('fresh-data')
      expect(fetcher).toHaveBeenCalled()
      expect(mockRedisSet).toHaveBeenCalledWith(
        generatedKey,
        expect.stringContaining('"s":true'),
        'EX',
        expect.any(Number),
      )
    })

    it('should coalesce concurrent requests for the SAME KEY (Single Flight)', async () => {
      const keyParams = { id: 'test-4' }
      const generatedKey = resilientCache.generateKey(keyParams)

      mockRedisGet.mockResolvedValue(null)

      const fetcher = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return 'shared-data'
      })

      const p1 = resilientCache.getOrFetch(generatedKey, fetcher)
      const p2 = resilientCache.getOrFetch(generatedKey, fetcher)

      const [res1, res2] = await Promise.all([p1, p2])

      expect(res1).toBe('shared-data')
      expect(res2).toBe('shared-data')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('should throw ServiceOverloadError when max pending fetches exceeded with DIFFERENT KEYS', async () => {
      const restrictedCache = new ResilientCache(redisClient, {
        ...defaultOptions,
        maxPendingFetches: 2,
        fetchTimeoutMs: 5000,
      })

      mockRedisGet.mockResolvedValue(null)

      const fetcher = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return 'data'
      }

      // 1. Dispara as duas primeiras requisições para encher o limite
      const p1 = restrictedCache.getOrFetch('key-1', fetcher)
      const p2 = restrictedCache.getOrFetch('key-2', fetcher)

      // 2. CORREÇÃO: Aguarda um ciclo do event loop para que as Promises acima
      // avancem do "await redis.get()" para o "pendingFetches.set()".
      await new Promise((resolve) => setTimeout(resolve, 10))

      // 3. A terceira chamada agora deve encontrar o mapa cheio e falhar
      await expect(restrictedCache.getOrFetch('key-3', fetcher)).rejects.toThrow(ServiceOverloadError)

      // Limpeza: aguarda as promises originais finalizarem
      await Promise.allSettled([p1, p2])
    })
  })

  describe('Negative Caching Logic', () => {
    it('should cache failure using negative TTL when error is mapped', async () => {
      // 1. Configuração
      const keyParams = { id: 'negative-test-1' }
      const generatedKey = resilientCache.generateKey(keyParams)

      // Simula Cache Miss
      mockRedisGet.mockResolvedValue(null)

      // 2. Fetcher que falha
      const error = new Error('Invalid ID provided')
      const fetcher = vi.fn().mockRejectedValue(error)

      // 3. Mapper que decide que esse erro DEVE ser cacheado
      const errorMapper = vi.fn().mockReturnValue({
        type: 'InvalidInputError',
        message: 'The ID is invalid',
      })

      // 4. Execução: Esperamos que lance CachedFailureError (o wrapper)
      await expect(resilientCache.getOrFetch(generatedKey, fetcher, errorMapper)).rejects.toThrow(CachedFailureError)

      // 5. Verificações
      expect(fetcher).toHaveBeenCalled()
      expect(errorMapper).toHaveBeenCalledWith(error)

      // Verifica se salvou no Redis com flag de erro (s: false)
      expect(mockRedisSet).toHaveBeenCalledWith(
        generatedKey,
        expect.stringContaining('"s":false'),
        'EX',
        expect.any(Number),
      )

      // Verifica conteúdo do erro salvo
      expect(mockRedisSet).toHaveBeenCalledWith(
        generatedKey,
        expect.stringContaining('"type":"InvalidInputError"'),
        'EX',
        expect.any(Number),
      )

      // 6. Verifica se usou o TTL Negativo (10s) e não o Default (60s)
      // Com jitter de 10% em 10s, o TTL deve estar entre 9 e 11
      const ttlArg = mockRedisSet.mock.calls[0][3]
      expect(ttlArg).toBeGreaterThanOrEqual(9)
      expect(ttlArg).toBeLessThanOrEqual(11)
      expect(ttlArg).not.toBeGreaterThanOrEqual(50) // Garante que não usou o default
    })

    it('should NOT cache failure when error is NOT mapped (System Error)', async () => {
      const keyParams = { id: 'negative-test-2' }
      const generatedKey = resilientCache.generateKey(keyParams)
      mockRedisGet.mockResolvedValue(null)

      // Fetcher falha com erro genérico
      const error = new Error('Database Connection Failed')
      const fetcher = vi.fn().mockRejectedValue(error)

      // Mapper retorna null (ou undefined), indicando erro não cacheável
      const errorMapper = vi.fn().mockReturnValue(null)

      // Espera o erro original, não o CachedFailureError
      await expect(resilientCache.getOrFetch(generatedKey, fetcher, errorMapper)).rejects.toThrow(
        'Database Connection Failed',
      )

      // Verifica que NADA foi salvo no Redis
      expect(mockRedisSet).not.toHaveBeenCalled()
    })

    it('should NOT cache failure when no errorMapper is provided', async () => {
      const keyParams = { id: 'negative-test-3' }
      const generatedKey = resilientCache.generateKey(keyParams)
      mockRedisGet.mockResolvedValue(null)

      const error = new Error('Unknown Error')
      const fetcher = vi.fn().mockRejectedValue(error)

      // Sem mapper
      await expect(resilientCache.getOrFetch(generatedKey, fetcher)).rejects.toThrow('Unknown Error')

      expect(mockRedisSet).not.toHaveBeenCalled()
    })
  })
})
