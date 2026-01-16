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
  // Opção para controlar a % de variação (padrão 5%)
  ttlJitterPercentage?: number
}

export class ResilientCache {
  private readonly pendingFetches = new Map<string, Promise<any>>()
  private readonly MAX_PENDING: number
  private readonly FETCH_TIMEOUT: number
  private readonly JITTER_PERCENTAGE: number

  constructor(
    private readonly redis: Redis,
    private readonly options: ResilientCacheOptions,
  ) {
    this.MAX_PENDING = options.maxPendingFetches ?? 1_000
    this.FETCH_TIMEOUT = options.fetchTimeoutMs ?? 30_000
    this.JITTER_PERCENTAGE = options.ttlJitterPercentage ?? 0.05 // 5% de variação
  }

  /* ------------------------------------------------------------------------ */
  /* Geração de Chave                                                         */
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
  /* API Pública (Dedup com Promises)                                         */
  /* ------------------------------------------------------------------------ */

  async getOrFetch<T>(cacheKey: string, fetcher: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
    // 1. Request Coalescing (Memória local do Pod)
    const existing = this.pendingFetches.get(cacheKey)
    if (existing) {
      logger.debug({ cacheKey }, 'Requisição coalescida - reutilizando fetch pendente')
      return existing
    }

    // 2. Load shedding
    if (this.pendingFetches.size >= this.MAX_PENDING) {
      logger.warn({ cacheKey }, 'Pressão de memória: descartando requisição')
      throw new ServiceOverloadError()
    }

    // 3. Executa e garante limpeza do mapa ao final
    const promise = this.executeWithCleanup(cacheKey, fetcher)
    this.pendingFetches.set(cacheKey, promise)

    return promise
  }

  /* ------------------------------------------------------------------------ */
  /* Lógica Principal                                                         */
  /* ------------------------------------------------------------------------ */

  private async executeWithCleanup<T>(
    cacheKey: string,
    fetcher: (signal: AbortSignal) => Promise<T | null>,
  ): Promise<T | null> {
    const controller = new AbortController()

    try {
      return await this.withTimeout(
        this.execute(cacheKey, () => fetcher(controller.signal), controller.signal),
        this.FETCH_TIMEOUT,
        cacheKey,
        controller,
      )
    } finally {
      this.pendingFetches.delete(cacheKey)
    }
  }

  private async execute<T>(cacheKey: string, fetcher: () => Promise<T | null>, signal: AbortSignal): Promise<T | null> {
    // 1. Tenta ler do Redis
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached !== null) {
        logger.info({ cacheKey }, '✓ Cache HIT - Dados recuperados do Redis')
        return JSON.parse(cached) as T
      }
      logger.info({ cacheKey }, '✗ Cache MISS - Buscando dados da fonte')
    } catch (err) {
      logger.error({ err, cacheKey }, 'Falha no Redis - Continuando sem cache')
    }

    // 2. Se não tem cache, busca na fonte
    try {
      const result = await fetcher()

      // 3. Salva no cache com proteção contra "Zombies" e Jitter
      if (!signal.aborted) {
        this.saveToCache(cacheKey, result).catch((err) => logger.error({ err, cacheKey }, 'Falha ao escrever no cache'))
      } else {
        logger.warn({ cacheKey }, 'Fetch abortado - Pulando escrita no cache')
      }

      return result
    } catch (err) {
      // Se o fetcher falhou por abort, ainda precisamos logar o warning
      if (signal.aborted) {
        logger.warn({ cacheKey }, 'Fetch abortado - Pulando escrita no cache')
      }
      throw err
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Escrita no Cache (COM JITTER)                                            */
  /* ------------------------------------------------------------------------ */

  private async saveToCache<T>(cacheKey: string, result: T | null): Promise<void> {
    try {
      if (result === undefined) return

      const baseTtl = result === null ? this.options.negativeTtlSeconds : this.options.defaultTtlSeconds
      const jitterAmount = Math.floor(baseTtl * this.JITTER_PERCENTAGE)
      const randomOffset = Math.floor(Math.random() * (jitterAmount * 2 + 1)) - jitterAmount
      const finalTtl = Math.max(1, baseTtl + randomOffset)

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', finalTtl)

      logger.debug({ cacheKey, ttl: finalTtl, baseTtl }, 'Resultado armazenado em cache com Jitter')
    } catch (err) {
      logger.error({ err, cacheKey }, 'Falha ao escrever no cache')
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Proteção contra Timeout                                                  */
  /* ------------------------------------------------------------------------ */

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    cacheKey: string,
    controller?: AbortController,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller?.abort()
        reject(new TimeoutExceedOnFetchError())
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  // Helpers de monitoramento
  getPendingCount(): number {
    return this.pendingFetches.size
  }
  isUnderMemoryPressure(): boolean {
    return this.pendingFetches.size >= this.MAX_PENDING * 0.8
  }
}
