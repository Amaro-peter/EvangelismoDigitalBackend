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
  // [FIX] Mapa em memória para coalescer buscas simultâneas para a mesma chave
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
   * Ponto de entrada principal com Request Coalescing em Memória.
   * Isso previne cache stampedes mesmo se o Redis estiver completamente indisponível.
   */
  async getOrFetch<T>(cacheKey: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    // [FIX] Verifica primeiro as buscas pendentes em memória
    if (this.pendingFetches.has(cacheKey)) {
      logger.debug({ cacheKey }, 'Unindo busca em andamento (Request Coalescing)')
      return this.pendingFetches.get(cacheKey) as Promise<T | null>
    }

    const promise = this.executeGetOrFetch(cacheKey, fetcher)

    // Armazena a promise em memória para que outras possam se unir
    this.pendingFetches.set(cacheKey, promise)

    try {
      return await promise
    } finally {
      // Limpa o mapa de memória após conclusão
      this.pendingFetches.delete(cacheKey)
    }
  }

  private async executeGetOrFetch<T>(cacheKey: string, fetcher: () => Promise<T | null>): Promise<T | null> {
    // 1. Tenta Cache Primeiro
    let redisHealthy = true
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached !== null) {
        const parsed = this.parseCache<T>(cached, cacheKey)
        if (parsed !== undefined) {
          const isNegativeCache = parsed === null
          logger.info(
            { cacheKey, isNegativeCache },
            `✓ Cache HIT - ${isNegativeCache ? 'Cache negativo' : 'Dados em cache'}`,
          )
          return parsed
        }
      }
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Redis indisponível - ignorando cache')
      redisHealthy = false
    }

    // [FIX] Se o Redis estiver indisponível, prosseguimos para o fetcher, mas agora estamos protegidos
    // pelo mapa pendingFetches na função wrapper, prevenindo um stampede.
    if (!redisHealthy) {
      return fetcher()
    }

    // 2. Adquire Lock Distribuído
    const lockKey = `${cacheKey}:lock`
    const lockToken = crypto.randomBytes(16).toString('hex')
    const lockAcquired = await this.acquireLock(lockKey, lockToken)

    if (!lockAcquired) {
      return this.waitForCacheOrFallback(cacheKey, lockKey, fetcher)
    }

    try {
      // 3. Verifica cache novamente (Double-Checked Locking)
      try {
        const recheck = await this.redis.get(cacheKey)
        if (recheck !== null) {
          const parsed = this.parseCache<T>(recheck, cacheKey)
          if (parsed !== undefined) {
            const isNegativeCache = parsed === null
            logger.info(
              { cacheKey, isNegativeCache },
              `✓ Cache HIT (verificação dupla) - ${isNegativeCache ? 'Cache negativo' : 'Dados em cache'}`,
            )
            return parsed
          }
        }
      } catch (err) {
        logger.warn({ err, cacheKey }, 'Erro no Redis durante verificação dupla')
      }

      // 4. Executa Fetcher
      const result = await fetcher()

      // 5. Salva no Cache
      await this.saveToCache(cacheKey, result)

      return result
    } finally {
      // 6. Libera Lock & Notifica Aguardando
      await this.releaseLock(lockKey, lockToken)
    }
  }

  private parseCache<T>(cached: string, cacheKey: string): T | null | undefined {
    try {
      return JSON.parse(cached)
    } catch (parseError) {
      logger.warn({ err: parseError, cacheKey }, 'JSON inválido no cache, ignorando')
      return undefined
    }
  }

  private async acquireLock(lockKey: string, token: string): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, token, 'PX', this.LOCK_TTL_MS, 'NX')
      return result === 'OK'
    } catch (err) {
      logger.warn({ err, lockKey }, 'Erro no Redis ao adquirir lock - prosseguindo em modo degradado')
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
      logger.warn({ err, lockKey }, 'Erro no Redis ao liberar lock')
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
      logger.warn({ err }, 'Falha ao se inscrever no canal de lock, usando polling')
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
                `✓ Cache HIT (após espera) - ${isNegativeCache ? 'Cache negativo' : 'Dados em cache'}`,
              )
              return parsed
            }
          }

          const fallbackResult = await this.tryAcquireAndFetch(cacheKey, lockKey, fetcher)
          if (fallbackResult !== undefined) return fallbackResult
        }
      } catch (err) {
        logger.warn({ err }, 'Erro no Redis durante loop de espera')
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
    logger.warn({ cacheKey }, 'Timeout de espera do lock - buscando em modo degradado')
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
              `✓ Cache HIT (fallback) - ${isNegativeCache ? 'Cache negativo' : 'Dados em cache'}`,
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
        `Armazenando ${isNegativeCache ? 'resultado negativo' : 'resultado'} em cache com TTL de ${Math.round(ttl / 86400)}d`,
      )

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttl)
    } catch (err) {
      logger.error({ err, cacheKey }, 'Erro no Redis ao gravar cache')
    }
  }

  private getSubscriber(): Redis {
    if (!this.subClient) {
      this.subClient = this.redis.duplicate()
      this.subClient.on('error', (err) => logger.error({ err }, 'Erro no Subscriber do Redis'))
    }
    return this.subClient
  }
}
