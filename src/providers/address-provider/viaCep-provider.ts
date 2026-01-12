import axios, { AxiosError, AxiosInstance } from 'axios'
import https from 'https'
import { AddressData, AddressProvider } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { logger } from '@lib/logger'

export class ViaCepProvider implements AddressProvider {
  private static api: AxiosInstance
  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly VIACEP_TIMEOUT = 3000
  private readonly KEEP_ALIVE = true
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor() {
    if (!ViaCepProvider.api) {
      const httpsAgent = new https.Agent({
        keepAlive: this.KEEP_ALIVE,
        keepAliveMsecs: this.KEEP_ALIVE_MSECS,
        maxSockets: this.MAX_SOCKETS,
        maxFreeSockets: this.MAX_FREE_SOCKETS,
        timeout: this.HTTPS_AGENT_TIMEOUT,
      })

      ViaCepProvider.api = axios.create({
        baseURL: process.env.VIACEP_API_URL,
        timeout: this.VIACEP_TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0 (contact@findhope.digital)',
        },
        httpsAgent,
      })
    }
  }

  async fetchAddress(cep: string): Promise<AddressData> {
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await ViaCepProvider.api.get(`/${cep}/json/`)

        if (response.data?.erro) {
          logger.warn({ cep, attempt }, 'CEP inválido retornado pela API ViaCEP')
          throw new InvalidCepError()
        }

        const { logradouro, bairro, localidade, uf } = response.data
        logger.info({ cep, attempt }, 'Endereço obtido com sucesso da API ViaCEP')
        return { logradouro, bairro, localidade, uf }
      } catch (error) {
        const err = error as AxiosError
        const status = err.response?.status
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
          logger.error({ cep, attempt, status, error: err.message }, 'Falha ao buscar endereço após tentativas')
          throw error
        }

        const delay = this.BACKOFF_MS * Math.pow(2, attempt)
        logger.warn({ cep, attempt, delay, status }, 'Repetindo solicitação para ViaCEP')
        await this.sleep(delay)
      }
    }

    throw new Error('Unexpected error in fetchAddress')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
