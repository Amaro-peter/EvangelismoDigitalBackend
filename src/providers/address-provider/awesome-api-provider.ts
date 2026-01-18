import { AxiosError, AxiosInstance } from 'axios'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { createHttpClient } from '@lib/http/axios'
import { RedisRateLimiter } from '@lib/redis/helper/rate-limiter'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'

export interface AwesomeApiConfig {
  apiUrl: string
  apiToken: string
}

export class AwesomeApiProvider implements AddressProvider {
  private static api: AxiosInstance

  // Configuração Fail-Fast: 5 requisições por segundo
  private readonly RATE_LIMIT_MAX = 5
  private readonly RATE_LIMIT_WINDOW = 1

  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 100
  private readonly TIMEOUT = 1500

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 100
  private readonly MAX_FREE_SOCKETS = 10
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(
    private readonly config: AwesomeApiConfig,
    private readonly rateLimiter: RedisRateLimiter,
  ) {
    if (!AwesomeApiProvider.api) {
      AwesomeApiProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.TIMEOUT,
        headers: {
          'x-api-key': this.config.apiToken,
        },
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

      // Fail-Fast Rate Limit Check
      const allowed = await this.rateLimiter.tryConsume(
        'awesomeapi-global',
        this.RATE_LIMIT_MAX,
        this.RATE_LIMIT_WINDOW,
      )

      if (!allowed) {
        throw new AddressServiceBusyError('AwesomeAPI (Rate Limit Exceeded)')
      }

      try {
        const response = await AwesomeApiProvider.api.get(`/json/${cleanCep}`, {
          signal,
        })

        // Check if response has invalid/empty data
        if (!response.data || (!response.data.city && !response.data.state)) {
          logger.warn({ cep: cleanCep, attempt }, 'CEP inválido/vazio retornado pela AwesomeAPI')
          // Return null so ResilientAddressProvider can try next provider
          return null
        }

        const { address, district, city, state, lat, lng } = response.data

        logger.info({ cep: cleanCep, attempt }, 'Endereço obtido com sucesso da AwesomeAPI')

        return {
          logradouro: address,
          bairro: district,
          localidade: city,
          uf: state,
          lat: lat ? parseFloat(lat) : undefined,
          lon: lng ? parseFloat(lng) : undefined,
        }
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
          logger.warn({ cep: cleanCep, attempt, status }, 'CEP não encontrado na AwesomeAPI (404)')
          return null
        }

        // Check if error is retryable (network issues, 5xx, 429)
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
          logger.error(
            { cep: cleanCep, attempt, status, error: err.message },
            'Falha ao buscar endereço AwesomeAPI após tentativas',
          )
          throw error
        }

        // Backoff and retry for transient errors
        const delay = this.BACKOFF_MS * Math.pow(2, attempt - 1)
        logger.warn({ cep: cleanCep, attempt, delay, status }, 'Repetindo solicitação para AwesomeAPI')
        await this.sleep(delay)
      }
    }

    // This should be unreachable due to retry logic, but as safety net
    logger.error({ cep: cleanCep }, 'AwesomeAPI: Unexpected code path - all retries exhausted without throw')
    throw new Error('AwesomeAPI: All retry attempts exhausted')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
