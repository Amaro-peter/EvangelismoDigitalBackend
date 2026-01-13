import axios, { AxiosError, AxiosInstance } from 'axios'
import https from 'https'
import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { logger } from '@lib/logger'

export class ViaCepProvider implements AddressProvider {
  private static api: AxiosInstance
  private readonly redis: Redis
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days
  private readonly CACHE_PREFIX = 'cache:viacep:'

  private readonly MAX_RETRIES = 2
  private readonly BACKOFF_MS = 300
  private readonly VIACEP_TIMEOUT = 3000
  private readonly KEEP_ALIVE = true
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor(redisConnection: Redis) {
    this.redis = redisConnection

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
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = `${this.CACHE_PREFIX}${cleanCep}`

    // 1. Try Cache
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        logger.info({ cep: cleanCep }, 'Address fetched from Redis cache')
        return JSON.parse(cached) as AddressData
      }
    } catch (err) {
      logger.error({ error: err }, 'Redis error during ViaCEP cache read')
    }

    // 2. Fetch from API
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await ViaCepProvider.api.get(`/${cleanCep}/json/`)

        // Robust error checking for boolean or string "true"
        const hasError = response.data?.erro === true || response.data?.erro === 'true'

        if (hasError) {
          logger.warn({ cep: cleanCep, attempt }, 'CEP inválido retornado pela API ViaCEP')
          throw new InvalidCepError()
        }

        const { logradouro, bairro, localidade, uf } = response.data
        const addressData: AddressData = { logradouro, bairro, localidade, uf }

        logger.info({ cep: cleanCep, attempt }, 'Endereço obtido com sucesso da API ViaCEP')

        // 3. Save to Cache
        try {
          await this.redis.set(cacheKey, JSON.stringify(addressData), 'EX', this.CACHE_TTL_SECONDS)
        } catch (err) {
          logger.error({ error: err }, 'Redis error during ViaCEP cache write')
        }

        return addressData
      } catch (error) {
        if (error instanceof InvalidCepError) throw error

        const err = error as AxiosError
        const status = err.response?.status
        const isRetryable = !err.response || (typeof status === 'number' && (status >= 500 || status === 429))

        if (!isRetryable || attempt === this.MAX_RETRIES) {
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

    throw new Error('Unexpected error in fetchAddress')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
