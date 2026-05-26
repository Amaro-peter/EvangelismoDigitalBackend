import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { NoAddressProviderError } from './error/no-address-provider-error'
import { AddressProviderFailureError } from './error/address-provider-failure-error'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { TimeoutExceededOnFetchError } from '@lib/errors/infra/cache/timeout-exceed-on-fetch-error'
import { IAddressData, IAddressProvider } from 'core/contracts/use-cases/providers/address-provider.interface'

export class ResilientAddressProvider implements IAddressProvider {
  constructor(private readonly providers: IAddressProvider[]) {
    if (this.providers.length === 0) {
      throw new NoAddressProviderError()
    }
  }

  async fetchAddress(cep: string, signal?: AbortSignal): Promise<IAddressData | null> {
    const cleanCep = cep.replace(/\D/g, '')
    const effectiveSignal = signal ?? new AbortController().signal

    return await this.executeStrategy(cleanCep, effectiveSignal)
  }

  private async executeStrategy(cep: string, signal: AbortSignal): Promise<IAddressData> {
    let lastError: Error | unknown = undefined
    let hasSystemError = false
    let lastProviderName = ''
    let notFoundCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive check: Stop immediately if timeout/abort fired
      if (signal.aborted) {
        throw new TimeoutExceededOnFetchError(signal.reason)
      }

      try {
        const result = await provider.fetchAddress(cep, signal)

        if (result) {
          logger.info({ provider: providerName }, 'Endereço obtido com sucesso por um provedor de endereço')
          return result
        }

        // Provider returned null (not found) - count and try next provider
        notFoundCount++
        logger.info({ provider: providerName }, 'Provedor retornou null (não encontrado) - tentando próximo')
      } catch (error) {
        if (error instanceof TimeoutExceededOnFetchError) {
          throw error
        }

        // Business Error: Provider explicitly confirmed CEP doesn't exist
        if (error instanceof InvalidCepError) {
          notFoundCount++
          logger.info({ provider: providerName, cep }, 'CEP inválido reportado por provedor - tentando próximo')
          continue
        }

        // Check if error is 404 - treat as "not found" and try next provider
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          notFoundCount++
          logger.info({ provider: providerName }, 'Provedor retornou 404 (Não Encontrado) - tentando próximo')
          continue
        }

        // SYSTEM ERROR: Record that a system error occurred
        hasSystemError = true
        lastError = error
        lastProviderName = providerName
        const errMsg = error instanceof Error ? error.message : String(error)

        if (error instanceof AddressServiceBusyError) {
          logger.warn(
            { provider: providerName, error: errMsg, attempt: index + 1 },
            'Provedor de endereço ocupado (429). Alternando para o próximo provedor...',
          )
        } else {
          logger.warn({ provider: providerName, error: errMsg }, 'Provedor falhou (Erro de Sistema). Alternando...')
        }
      }
    }

    // === DECISION PHASE ===
    // Priority 1: If we had system errors, throw the last error
    // This ensures we retry when providers are unstable, even if some said "not found"
    if (hasSystemError) {
      logger.error(
        { cep, provider: lastProviderName, notFoundCount },
        'Provedores de endereço falharam com erros de sistema',
      )

      if (lastError instanceof AddressServiceBusyError) {
        throw lastError
      }

      throw new AddressProviderFailureError(lastError)
    }

    // Priority 2: ALL providers returned null/404/InvalidCepError (no system errors)
    // Only throw InvalidCepError if ALL providers confirmed it doesn't exist
    if (notFoundCount === this.providers.length) {
      logger.info(
        { cep, notFoundCount, totalProviders: this.providers.length },
        'TODOS os provedores confirmaram CEP inválido',
      )
      throw new InvalidCepError()
    }

    // This should be unreachable, but as safety net
    throw new AddressProviderFailureError()
  }
}
