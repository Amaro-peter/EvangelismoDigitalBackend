// Mock environment variables FIRST
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
  },
}))

import { RedisRateLimiter, EnumProviderConfig } from './rate-limiter'
import { RateLimiterRedis } from 'rate-limiter-flexible'
import Redis from 'ioredis'
import { logger } from '@lib/logger'

// --- CORREÇÃO AQUI: MOCK IOREDIS ---
// Usamos 'function()' para permitir o uso de 'new Redis()'
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        quit: vi.fn().mockResolvedValue('OK'),
      }
    }),
  }
})

vi.mock('@lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// --- CORREÇÃO AQUI: MOCK RATE LIMITER FLEXIBLE ---
const mockConsume = vi.fn()

vi.mock('rate-limiter-flexible', () => {
  return {
    // Usamos 'function()' para permitir o uso de 'new RateLimiterRedis()'
    RateLimiterRedis: vi.fn().mockImplementation(function () {
      return {
        consume: mockConsume,
      }
    }),
  }
})

describe('RedisRateLimiter', () => {
  let redisClient: Redis

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset manual do Singleton
    ;(RedisRateLimiter as any).instance = undefined

    redisClient = new Redis() as unknown as Redis
  })

  describe('Singleton Pattern', () => {
    it('should always return the same instance', () => {
      const instance1 = RedisRateLimiter.getInstance(redisClient)
      const instance2 = RedisRateLimiter.getInstance(redisClient)

      expect(instance1).toBe(instance2)
      // Verifica se o construtor do RateLimiterRedis NÃO foi chamado na instanciação do Singleton
      expect(RateLimiterRedis).not.toHaveBeenCalled()
    })
  })

  describe('tryConsume()', () => {
    it('should return TRUE when points are available (Allowed)', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)
      const provider = EnumProviderConfig.VIACEP_ADDRESS

      // Mock sucesso
      mockConsume.mockResolvedValueOnce({ remainingPoints: 4 })

      const result = await limiter.tryConsume(provider)

      expect(result).toBe(true)

      expect(RateLimiterRedis).toHaveBeenCalledWith(
        expect.objectContaining({
          keyPrefix: `ratelimit:v1:${provider}`,
          points: 5,
        }),
      )
      expect(mockConsume).toHaveBeenCalledWith('global', 1)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('should return FALSE when rate limit is exceeded (Blocked - Business Logic)', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)
      const provider = EnumProviderConfig.VIACEP_ADDRESS

      // Mock estouro de limite
      mockConsume.mockRejectedValueOnce({ remainingPoints: 0, msBeforeNext: 1000 })

      const result = await limiter.tryConsume(provider)

      expect(result).toBe(false)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('should return FALSE and log ERROR when Redis fails (Fail-Closed / Infra Error)', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)
      const provider = EnumProviderConfig.AWESOME_API_ADDRESS

      // Mock erro de infraestrutura
      const redisError = new Error('Connection lost')
      mockConsume.mockRejectedValueOnce(redisError)

      const result = await limiter.tryConsume(provider)

      expect(result).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        { error: redisError, provider },
        expect.stringContaining('ERRO CRÍTICO RedisRateLimiter'),
      )
    })

    it('should return FALSE and log ERROR for unconfigured providers', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)
      const invalidProvider = 'INVALID_PROVIDER_KEY'

      const result = await limiter.tryConsume(invalidProvider)

      expect(result).toBe(false)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: invalidProvider,
          error: expect.any(Error),
        }),
        expect.stringContaining('ERRO CRÍTICO'),
      )
    })

    it('should instantiate RateLimiterRedis only once per provider (Internal Caching)', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)
      const provider = EnumProviderConfig.BRASIL_API_ADDRESS

      mockConsume.mockResolvedValue({ remainingPoints: 1 })

      await limiter.tryConsume(provider)
      await limiter.tryConsume(provider)

      expect(RateLimiterRedis).toHaveBeenCalledTimes(1)
      expect(mockConsume).toHaveBeenCalledTimes(2)
    })
  })

  describe('Configuration & Observability', () => {
    it('should use correct points/duration for different providers', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)

      await limiter.tryConsume(EnumProviderConfig.NOMINATIM_GEOCODING)
      expect(RateLimiterRedis).toHaveBeenLastCalledWith(
        expect.objectContaining({
          points: 1,
          duration: 1,
          keyPrefix: `ratelimit:v1:${EnumProviderConfig.NOMINATIM_GEOCODING}`,
        }),
      )

      await limiter.tryConsume(EnumProviderConfig.LOCATION_IQ_ADDRESS)
      expect(RateLimiterRedis).toHaveBeenLastCalledWith(
        expect.objectContaining({
          points: 2,
          duration: 1,
          keyPrefix: `ratelimit:v1:${EnumProviderConfig.LOCATION_IQ_ADDRESS}`,
        }),
      )
    })

    it('should log WARN if too many limiters are created (Defensive Coding)', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient) as any

      for (let i = 0; i < 51; i++) {
        limiter.limiters.set(`fake_provider_${i}`, {} as any)
      }

      limiter.limiters.delete(EnumProviderConfig.VIACEP_ADDRESS)

      mockConsume.mockResolvedValue({})
      await limiter.tryConsume(EnumProviderConfig.VIACEP_ADDRESS)

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ size: expect.any(Number) }),
        expect.stringContaining('Muitos RateLimiters instanciados'),
      )
    })
  })

  describe('destroy()', () => {
    it('should close redis connection and clear limiters', async () => {
      const limiter = RedisRateLimiter.getInstance(redisClient)

      await limiter.tryConsume(EnumProviderConfig.BRASIL_API_ADDRESS)

      await limiter.destroy()

      expect(redisClient.quit).toHaveBeenCalled()
      expect((limiter as any).limiters.size).toBe(0)
    })
  })
})
