import { AxiosError, AxiosInstance } from 'axios'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { createHttpClient } from '@lib/http/axios'
import { RedisRateLimiter } from '@lib/redis/helper/rate-limiter'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { ViaCepProviderError } from './error/via-cep-error'

export interface ViaCepConfig {
  apiUrl: string
}

export class ViaCepProvider implements AddressProvider {
  private static api: AxiosInstance

  // Configuração Fail-Fast: 5 requisições por segundo
  private readonly RATE_LIMIT_MAX = 5
  private readonly RATE_LIMIT_WINDOW = 1

  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 100
  private readonly VIACEP_TIMEOUT = 1500

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 100
  private readonly MAX_FREE_SOCKETS = 10
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    private readonly config: ViaCepConfig,
    private readonly rateLimiter: RedisRateLimiter,
  ) {
    if (!ViaCepProvider.api) {
      ViaCepProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.VIACEP_TIMEOUT,
        agentOptions: {
          keepAliveMsecs: this.KEEP_ALIVE_MSECS,
          maxSockets: this.MAX_SOCKETS,
          maxFreeSockets: this.MAX_FREE_SOCKETS,
          timeout: this.HTTPS_AGENT_TIMEOUT,
        },
      })
    }
  }

  async fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData | null> {
    const cleanCep = cep.replace(/\D/g, '')

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw signal.reason
      }

      // Fail-fast rate limit check
      const allowed = await this.rateLimiter.tryConsume('viacep-global', this.RATE_LIMIT_MAX, this.RATE_LIMIT_WINDOW)

      if (!allowed) {
        throw new AddressServiceBusyError('ViaCep (Rate Limit Exceeded)')
      }

      try {
        const response = await ViaCepProvider.api.get(`/${cleanCep}/json/`, {
          signal,
        })

        // ViaCEP returns { erro: true } for invalid CEPs
        const hasError = response.data?.erro === true || response.data?.erro === 'true'

        if (hasError) {
          logger.warn({ cep: cleanCep, attempt }, 'CEP inválido retornado pela API ViaCEP')
          // Return null so ResilientAddressProvider can try next provider
          return null
        }

        const { logradouro, bairro, localidade, uf } = response.data
        const addressData: AddressData = { logradouro, bairro, localidade, uf }

        logger.info({ cep: cleanCep, attempt }, 'Endereço obtido com sucesso da API ViaCEP')

        return addressData
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason
        }

        // If rate limit error (thrown above), don't retry locally, propagate it
        if (error instanceof AddressServiceBusyError) {
          throw error
        }

        const err = error as AxiosError
        const status = err.response?.status

        // 404 means CEP not found - return null to try next provider
        if (status === 404) {
          logger.warn({ cep: cleanCep, attempt, status }, 'CEP não encontrado na ViaCEP (404)')
          return null
        }

        // Check if error is retryable (network issues, 5xx, 429)
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
          logger.error(
            { cep: cleanCep, attempt, status, error: err.message },
            'Falha ao buscar endereço após tentativas (ViaCEP)',
          )
          throw error
        }

        // Backoff and retry for transient errors
        const delay = this.BACKOFF_MS * Math.pow(2, attempt - 1)
        logger.warn({ cep: cleanCep, attempt, delay, status }, 'Repetindo solicitação para ViaCEP')

        await this.sleep(delay)
      }
    }

    // This should be unreachable due to retry logic, but as safety net
    logger.error({ cep: cleanCep }, 'ViaCEP: Unexpected code path - all retries exhausted without throw')
    throw new ViaCepProviderError()
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
