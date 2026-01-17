import { AxiosError, AxiosInstance } from 'axios'
import { AddressData, AddressProvider } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { logger } from '@lib/logger'
import { createHttpClient } from '@lib/http/axios'
import { UnexpectedFetchAddressFailError } from './error/unexpected-fetch-address-fail-error'

export interface AwesomeApiConfig {
  apiUrl: string
  apiToken: string
}

export class AwesomeApiProvider implements AddressProvider {
  private static api: AxiosInstance

  private readonly MAX_RETRIES = 1
  private readonly BACKOFF_MS = 100
  private readonly TIMEOUT = 1500

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(private readonly config: AwesomeApiConfig) {
    if (!AwesomeApiProvider.api) {
      // Using the shared agent instead of the legacy maxSockets: 2 setting
      // to improve concurrency as requested.
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

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw signal.reason
      }

      try {
        const response = await AwesomeApiProvider.api.get(`/json/${cleanCep}`, {
          signal,
        })

        if (!response.data || (!response.data.city && !response.data.state)) {
          // Do not retry on domain logic errors (invalid content)
          logger.warn({ cep: cleanCep, attempt }, 'CEP inválido retornado pela AwesomeAPI')
          throw new InvalidCepError()
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

        // 1. Domain Error: Pass through immediately
        if (error instanceof InvalidCepError) throw error

        const err = error as AxiosError
        const status = err.response?.status

        // 2. Client Error (400/404): Fail fast, do not retry
        if (status === 400 || status === 404) {
          logger.warn({ cep: cleanCep, attempt, status }, 'CEP inválido na AwesomeAPI')
          throw new InvalidCepError()
        }

        // 3. Max Retries Reached?
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))
        if (!isRetryable || attempt === this.MAX_RETRIES) {
          logger.error(
            { cep: cleanCep, attempt, status, error: err.message },
            'Falha ao buscar endereço AwesomeAPI após tentativas',
          )
          throw error
        }

        // 4. Exponential Backoff
        const delay = this.BACKOFF_MS * Math.pow(2, attempt)
        logger.warn({ cep: cleanCep, attempt, delay, status }, 'Repetindo solicitação para AwesomeAPI')
        await this.sleep(delay)
      }
    }

    throw new UnexpectedFetchAddressFailError()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
