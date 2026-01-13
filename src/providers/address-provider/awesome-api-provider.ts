import axios, { AxiosError, AxiosInstance } from 'axios'
import https from 'https'
import { AddressData, AddressProvider } from './address-provider.interface'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'
import { logger } from '@lib/logger'

export class AwesomeApiProvider implements AddressProvider {
  private static api: AxiosInstance

  private readonly TIMEOUT = 3000
  private readonly KEEP_ALIVE_MSECS = 1000
  private readonly MAX_SOCKETS = 2
  private readonly MAX_FREE_SOCKETS = 2
  private readonly HTTPS_AGENT_TIMEOUT = 60000

  constructor() {
    if (!AwesomeApiProvider.api) {
      const httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: this.KEEP_ALIVE_MSECS,
        maxSockets: this.MAX_SOCKETS,
        maxFreeSockets: this.MAX_FREE_SOCKETS,
        timeout: this.HTTPS_AGENT_TIMEOUT,
      })

      AwesomeApiProvider.api = axios.create({
        baseURL: process.env.AWESOME_API_URL!,
        timeout: this.TIMEOUT,
        headers: {
          'x-api-key': process.env.AWESOME_API_TOKEN!,
        },
        httpsAgent,
      })
    }
  }

  async fetchAddress(cep: string): Promise<AddressData> {
    try {
      const cleanCep = cep.replace(/\D/g, '')
      const response = await AwesomeApiProvider.api.get(`/json/${cleanCep}`)

      if (!response.data || (!response.data.city && !response.data.state)) {
        logger.warn({ cep: cleanCep }, 'CEP inválido retornado pela AwesomeAPI')
        throw new InvalidCepError()
      }

      const { address, district, city, state, lat, lng } = response.data

      logger.info({ cep: cleanCep }, 'Endereço obtido com sucesso da AwesomeAPI')

      return {
        logradouro: address,
        bairro: district,
        localidade: city,
        uf: state,
        lat: lat ? parseFloat(lat) : undefined,
        lon: lng ? parseFloat(lng) : undefined,
      }
    } catch (error) {
      if (error instanceof InvalidCepError) throw error

      const err = error as AxiosError
      const status = err.response?.status

      if (status === 400 || status === 404) {
        logger.warn({ cep: cep.replace(/\D/g, ''), status }, 'CEP inválido na AwesomeAPI')
        throw new InvalidCepError()
      }

      logger.error({ cep: cep.replace(/\D/g, ''), status, error: err.message }, 'Falha ao buscar endereço AwesomeAPI')
      throw error
    }
  }
}
