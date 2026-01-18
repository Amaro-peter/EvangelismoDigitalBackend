import { logger } from "@lib/logger";
import Redis from "ioredis";


export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  /**
   * Consome um token do balde de rate limit.
   * Retorna TRUE se a requisição é permitida.
   * Retorna FALSE se o limite foi excedido (Fail-Fast).
   *
   * @param identifier Chave única para o limite (ex: 'nominatim', 'ip:127.0.0.1')
   * @param limit Número máximo de requisições permitidas na janela
   * @param windowSeconds Tamanho da janela de tempo em segundos
   */

  async tryConsume(identifier: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `ratelimit:${identifier}`

    try {
      const currentUsage = await this.redis.incr(key)

      if (currentUsage === 1) {
        await this.redis.expire(key, windowSeconds)
      }

      return currentUsage <= limit
    } catch (error) {
      // Fail-Closed Strategy (Opção A):
      // Se o Redis cair, bloqueamos a operação preventivamente.
      // Isso protege a API externa de receber tráfego não controlado que poderia banir sua chave.
      logger.error(
        { error, key },
        'Erro crítico ao verificar Rate Limit no Redis. Bloqueando requisição para proteção da infra (Fail-Closed).',
      )

      return false
    }
  }

}