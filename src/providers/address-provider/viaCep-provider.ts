import { AxiosError, AxiosInstance } from 'axios'
import { AddressData, AddressProvider } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { logger } from '@lib/logger'
import { createHttpClient } from '@lib/http/axios'
import { UnexpectedFetchAddressFailError } from './error/unexpected-fetch-address-fail-error'

export interface ViaCepConfig {
  apiUrl: string
}

export class ViaCepProvider implements AddressProvider {
  private static api: AxiosInstance

  private readonly MAX_RETRIES = 1
  private readonly BACKOFF_MS = 100
  private readonly VIACEP_TIMEOUT = 1500

  // HTTPS Agent Settings
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(private readonly config: ViaCepConfig) {
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

  // UPDATE: Accepts signal
  async fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData | null> {
    const cleanCep = cep.replace(/\D/g, '')

    for (let attempt = 1; attempt <= this.MAX_RETRIES + 1; attempt++) {
      // 1. Defensive Check: Stop if already aborted before request
      if (signal?.aborted) {
        throw signal.reason
      }

      try {
        // 2. Pass signal to Axios
        const response = await ViaCepProvider.api.get(`/${cleanCep}/json/`, {
          signal,
          // Note: Axios timeout is handled by the instance config,
          // but signal priority takes over if it fires first.
        })

        const hasError = response.data?.erro === true || response.data?.erro === 'true'

        if (hasError) {
          logger.warn({ cep: cleanCep, attempt }, 'CEP inválido retornado pela API ViaCEP')
          throw new InvalidCepError()
        }

        const { logradouro, bairro, localidade, uf } = response.data
        const addressData: AddressData = { logradouro, bairro, localidade, uf }

        logger.info({ cep: cleanCep, attempt }, 'Endereço obtido com sucesso da API ViaCEP')

        return addressData
      } catch (error) {
        // 3. Check for Abort immediately in catch
        if (signal?.aborted) {
          throw signal.reason
        }

        if (error instanceof InvalidCepError) throw error

        const err = error as AxiosError
        const status = err.response?.status

        // 4. Retry Logic
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt > this.MAX_RETRIES) {
          logger.error(
            { cep: cleanCep, attempt, status, error: err.message },
            'Falha ao buscar endereço após tentativas',
          )
          throw error
        }

        const delay = this.BACKOFF_MS * Math.pow(2, attempt)
        logger.warn({ cep: cleanCep, attempt, delay, status }, 'Repetindo solicitação para ViaCEP')

        await this.sleep(delay)
      }
    }

    throw new UnexpectedFetchAddressFailError()
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
