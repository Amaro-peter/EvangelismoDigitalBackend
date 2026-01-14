import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { ResilientCache } from '@lib/redis/resilient-cache'

enum AddressCacheScope {
  CEP = 'cep',
}

export class ResilientAddressProvider implements AddressProvider {
  private readonly cacheManager: ResilientCache

  constructor(
    private readonly providers: AddressProvider[],
    redis: Redis,
  ) {
    if (this.providers.length === 0) {
      throw new Error('ResilientAddressProvider requires at least one provider')
    }

    // Initialize the shared cache helper
    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:cep:', // Retaining original prefix
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour (Smart Negative Caching)
    })
  }

  async fetchAddress(cep: string): Promise<AddressData> {
    const cleanCep = cep.replace(/\D/g, '')

    // Generate a consistent cache key
    const cacheKey = this.cacheManager.generateKey({
      _scope: AddressCacheScope.CEP,
      cep: cleanCep,
    })

    // Execute with ResilientCache protection (Locking, Stampede Guard, etc.)
    const result = await this.cacheManager.getOrFetch<AddressData>(cacheKey, async () => {
      return this.executeStrategy(cleanCep)
    })

    // If result is null, it means "Invalid CEP" was cached negatively
    if (!result) {
      throw new InvalidCepError()
    }

    return result
  }

  /**
   * Iterates through providers.
   * - Returns AddressData on Success.
   * - Returns NULL on "Invalid CEP" (Logic Error) -> To be cached.
   * - Throws ERROR on System Failure (Network/Timeout) -> To abort cache.
   */
  private async executeStrategy(cep: string): Promise<AddressData | null> {
    let lastError: Error | null = null
    let invalidCepCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name
      const isLastProvider = index === this.providers.length - 1

      try {
        const result = await provider.fetchAddress(cep)

        if (result) {
          logger.info({ provider: providerName }, 'Address found successfully')
          return result
        }
      } catch (error) {
        // 1. Logic Error: Provider explicitly confirmed CEP doesn't exist
        if (error instanceof InvalidCepError) {
          invalidCepCount++
          // We continue trying other providers just in case one database is outdated,
          // but we record that at least one provider said "Invalid".
          continue
        }

        // 2. System Error: Network, Timeout, Rate Limit, 500s
        lastError = error as Error
        logger.warn(
          { provider: providerName, error: lastError.message },
          'Provider failed (System Error). Switching to fallback...',
        )
      }
    }

    // === DECISION PHASE ===

    // Case A: At least one provider said "Invalid CEP" and no one else succeeded.
    // We treat this as a confirmed "Not Found".
    // RETURN NULL -> This tells ResilientCache to store a Negative Cache entry (1 hour).
    if (invalidCepCount > 0) {
      logger.warn({ cep, invalidCepCount }, 'CEP confirmed as invalid by providers')
      return null
    }

    // Case B: All providers failed with System Errors (no one said "Invalid CEP").
    // We DO NOT return null, because that would cache a system outage as "Not Found".
    // THROW -> This tells ResilientCache to ABORT saving anything.
    logger.error({ cep, lastError }, 'All address providers failed with system errors')
    throw lastError || new Error('All address providers failed')
  }
}
