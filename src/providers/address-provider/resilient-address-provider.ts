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

    this.cacheManager = new ResilientCache(redis, {
      prefix: 'cache:cep:',
      defaultTtlSeconds: 60 * 60 * 24 * 90, // 90 days
      negativeTtlSeconds: 60 * 60, // 1 hour
    })
  }

  async fetchAddress(cep: string): Promise<AddressData> {
    const cleanCep = cep.replace(/\D/g, '')

    const cacheKey = this.cacheManager.generateKey({
      _scope: AddressCacheScope.CEP,
      cep: cleanCep,
    })

    const result = await this.cacheManager.getOrFetch<AddressData>(cacheKey, async () => {
      return this.executeStrategy(cleanCep)
    })

    // If result is null, it means "Invalid CEP" was cached negatively
    if (!result) {
      throw new InvalidCepError()
    }

    return result
  }

  private async executeStrategy(cep: string): Promise<AddressData | null> {
    let lastError: Error | null = null
    let hasSystemError = false // [FIX] Track system errors

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      try {
        const result = await provider.fetchAddress(cep)

        if (result) {
          logger.info({ provider: providerName }, 'Address found successfully')
          return result
        }
      } catch (error) {
        // 1. Logic Error: Provider explicitly confirmed CEP doesn't exist
        if (error instanceof InvalidCepError) {
          // We count this as a vote for "Not Found", but we don't stop.
          continue
        }

        // 2. System Error: Network, Timeout, Rate Limit, 500s
        hasSystemError = true
        lastError = error as Error
        logger.warn(
          { provider: providerName, error: lastError.message },
          'Provider failed (System Error). Switching to fallback...',
        )
      }
    }

    // === DECISION PHASE ===

    // [FIX] Abort cache if system errors occurred.
    // We only return null (Negative Cache) if strictly NO system errors happened.
    if (hasSystemError) {
      logger.error({ cep, lastError }, 'Address providers failed with system errors (aborting cache)')
      throw lastError || new Error('All address providers failed')
    }

    // If we reached here, all providers either returned null (unlikely for address)
    // or threw InvalidCepError.
    logger.warn({ cep }, 'CEP confirmed as invalid by providers')
    return null
  }
}
