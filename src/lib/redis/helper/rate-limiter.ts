import { logger } from '@lib/logger'
import Redis from 'ioredis'
import crypto from 'crypto'

export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  /**
   * Script Lua com "Self-Healing" (Auto-Cura).
   * * Lógica:
   * 1. Incrementa (INCR). O Redis cria como 1 se não existir.
   * 2. Verifica o TTL da chave.
   * 3. Se for nova (current == 1) OU se perdeu o TTL (ttl == -1), define a expiração.
   * * Vantagem: Protege contra "Chaves Zumbis" que bloqueiam usuários infinitamente
   * caso o Redis perca o TTL por falha de persistência.
   */
  private readonly LUA_INCR_EXPIRE_SAFE = `
    local current = redis.call('INCR', KEYS[1])
    local ttl = redis.call('TTL', KEYS[1])

    -- Se é o primeiro acesso OU se a chave existe mas está sem TTL (zumbi)
    if current == 1 or ttl == -1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end

    return current
  `

  private readonly LUA_SHA = crypto.createHash('sha1').update(this.LUA_INCR_EXPIRE_SAFE).digest('hex')

  async tryConsume(identifier: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `ratelimit:${identifier}`

    try {
      let result: unknown

      try {
        result = await this.redis.evalsha(this.LUA_SHA, 1, key, windowSeconds)
      } catch (error: any) {
        if (error?.message?.includes('NOSCRIPT')) {
          result = await this.redis.eval(this.LUA_INCR_EXPIRE_SAFE, 1, key, windowSeconds)
        } else {
          throw error
        }
      }

      const currentUsage = Number(result)
      return currentUsage <= limit
    } catch (error) {
      logger.error({ error, key }, 'Erro crítico no Rate Limiter (Redis). Fail-Closed.')
      return false
    }
  }
}

export function createRedisRateLimiter(redisConnection: Redis): RedisRateLimiter {
  return new RedisRateLimiter(redisConnection)
}
