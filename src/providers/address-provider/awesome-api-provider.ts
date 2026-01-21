import { AxiosError, AxiosInstance } from 'axios'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { createHttpClient } from '@lib/http/axios'
import { RedisRateLimiter } from '@lib/redis/helper/rate-limiter'
import { AddressServiceBusyError } from '@use-cases/errors/address-service-busy-error'
import { PrecisionHelper } from 'providers/helpers/precision-helper'
import Redis from 'ioredis'

export interface AwesomeApiConfig {
  apiUrl: string
  apiToken: string
}

// [MUDANÇA 2] Garantir que a interface da resposta da API esteja definida
interface AwesomeApiResponse {
  cep: string
  address_type: string
  address_name: string
  address: string
  state: string
  district: string
  lat: string
  lng: string
  city: string
  city_ibge: string
  ddd: string
}

export class AwesomeApiProvider implements AddressProvider {
  private static api: AxiosInstance

  // Configuração Fail-Fast: 5 requisições por segundo dentro do RedisRateLimiter
  // RATE_LIMIT_MAX = 5
  // RATE_LIMIT_WINDOW = 1

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
    private readonly redisRateLimiterConnection: Redis,
  ) {
    if (!AwesomeApiProvider.api) {
      AwesomeApiProvider.api = createHttpClient({
        baseURL: this.config.apiUrl,
        timeout: this.TIMEOUT,
        headers: {
          'User-Agent': 'EvangelismoDigitalBackend/1.0',
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

    // Fail-Fast Rate Limit Check
    const rateLimiter = RedisRateLimiter.getInstance(this.redisRateLimiterConnection)

    const allowed = await rateLimiter.tryConsume('awesomeApiAddressProvider')

    if (!allowed) {
      throw new AddressServiceBusyError('AwesomeAPI (Rate Limit Exceeded)')
    }

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw signal.reason
      }

      try {
        const { data } = await AwesomeApiProvider.api.get<AwesomeApiResponse>(`/${cleanCep}`, {
          signal,
        })

        if (!data || !data.cep) {
          return null
        }

        // [MUDANÇA 3] Normalizar dados para o PrecisionHelper
        // A AwesomeAPI usa 'address_name' para rua e 'district' para bairro
        const normalizedData = {
          logradouro: data.address_name,
          bairro: data.district,
          localidade: data.city,
          uf: data.state,
        }

        const precision = PrecisionHelper.fromAddressData(normalizedData)

        return {
          logradouro: data.address_name,
          bairro: data.district,
          localidade: data.city,
          uf: data.state,
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lng),
          precision: precision,
        }
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason
        }

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
    throw new Error('Unexpected error in AwesomeApiProvider')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
