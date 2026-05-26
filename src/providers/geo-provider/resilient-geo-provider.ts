import { logger } from '@lib/logger'
import { GeoServiceBusyError } from '@use-cases/errors/geo-service-busy-error'
import { NoGeoProviderError } from './error/no-geo-provider-error'
import { GeoProviderFailureError } from '@use-cases/errors/geo-provider-failure-error'
import { CoordinatesNotFoundError } from '@use-cases/errors/coordinates-not-found-error'
import { TimeoutExceededOnFetchError } from '@lib/errors/infra/cache/timeout-exceed-on-fetch-error'
import {
  IGeocodingProvider,
  IGeoCoordinates,
  IGeoSearchOptions,
} from 'core/contracts/use-cases/providers/geo-provider.interface'

export class ResilientGeoProvider implements IGeocodingProvider {
  constructor(private readonly providers: IGeocodingProvider[]) {
    if (this.providers.length === 0) {
      throw new NoGeoProviderError()
    }
  }

  async search(query: string, signal?: AbortSignal): Promise<IGeoCoordinates | null> {
    const effectiveSignal = signal ?? new AbortController().signal

    return await this.executeStrategy(
      (provider, innerSignal) => provider.search(query, innerSignal),
      effectiveSignal,
    )
  }

  async searchStructured(options: IGeoSearchOptions, signal?: AbortSignal): Promise<IGeoCoordinates | null> {
    const effectiveSignal = signal ?? new AbortController().signal

    return await this.executeStrategy(
      (provider, innerSignal) => provider.searchStructured(options, innerSignal),
      effectiveSignal,
    )
  }

  private async executeStrategy(
    action: (provider: IGeocodingProvider, signal: AbortSignal) => Promise<IGeoCoordinates | null>,
    signal: AbortSignal,
  ): Promise<IGeoCoordinates> {
    let lastError: Error | unknown = undefined
    let hasSystemError = false
    let lastProviderName = ''
    let notFoundCount = 0

    for (const [index, provider] of this.providers.entries()) {
      const providerName = provider.constructor.name

      // Defensive Check: Stop immediately if timeout/abort fired
      if (signal.aborted) {
        throw new TimeoutExceededOnFetchError(signal.reason)
      }

      try {
        const result = await action(provider, signal)

        if (result !== null) {
          logger.info({ provider: providerName }, 'Geocodificação obtida com sucesso por um provedor de geocodificação')
          return result
        }

        // Provider returned null (not found) - try next provider
        notFoundCount++
        logger.info({ provider: providerName }, 'Provedor retornou null (não encontrado) - tentando próximo')
      } catch (error) {
        if (error instanceof TimeoutExceededOnFetchError) {
          throw error
        }

        if (error instanceof CoordinatesNotFoundError) {
          notFoundCount++
          logger.info({ provider: providerName }, 'Coordenadas não encontradas - tentando próximo')
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

        if (error instanceof GeoServiceBusyError) {
          logger.warn(
            { provider: providerName, attempt: index + 1 },
            'Provedor de geocodificação ocupado (429). Alternando para o próximo provedor...',
          )
        } else {
          logger.warn({ provider: providerName, error: errMsg }, 'Provedor falhou (Erro de Sistema). Alternando...')
        }
      }
    }

    // === DECISION PHASE ===
    // If we had system errors, throw the last error
    if (hasSystemError) {
      logger.error({ provider: lastProviderName }, 'Geocodificação falhou com erros de sistema')

      if (lastError instanceof GeoServiceBusyError) {
        throw lastError
      }

      throw new GeoProviderFailureError(lastError)
    }

    // All providers returned null or 404 (no system errors)
    // This is a business error: coordinates legitimately don't exist
    if (notFoundCount === this.providers.length) {
      logger.info('Nenhum provedor retornou resultados - coordenadas não encontradas')
      throw new CoordinatesNotFoundError()
    }

    throw new GeoProviderFailureError()
  }
}
