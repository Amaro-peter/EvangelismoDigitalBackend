import { Redis } from 'ioredis'
import { AddressData, AddressProvider } from './address-provider.interface'
import { logger } from '@lib/logger'
import { InvalidCepError } from '@use-cases/errors/invalid-cep-error'

export class ResilientAddressProvider implements AddressProvider {
  private readonly CACHE_PREFIX = 'cache:cep:'
  private readonly CACHE_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 dias

  constructor(
    private readonly providers: AddressProvider[],
    private readonly redis: Redis,
  ) {}

  async fetchAddress(cep: string): Promise<AddressData> {
    const cleanCep = cep.replace(/\D/g, '')
    const cacheKey = `${this.CACHE_PREFIX}${cleanCep}`

    // 1. Tentar Cache (Redis)
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        logger.info({ cep: cleanCep }, 'Endereço recuperado do cache (Redis)')
        return JSON.parse(cached) as AddressData
      }
    } catch (err) {
      logger.error({ error: err }, 'Erro ao ler cache do Redis')
    }

    // 2. Tentar Providers em Ordem (Fallback Strategy)
    let lastError: any = new Error('Nenhum provedor de endereço configurado')

    for (const provider of this.providers) {
      const providerName = provider.constructor.name
      try {
        const result = await provider.fetchAddress(cleanCep)

        // 3. Sucesso: Salvar no Cache e Retornar
        this.saveToCache(cacheKey, result)
        return result
      } catch (error) {
        lastError = error

        // Se for erro de CEP Inválido (não existe), não adianta tentar outros providers geralmente,
        // mas em caso de inconsistência entre bases, pode valer a pena continuar.
        // Aqui optamos por logar e tentar o próximo.
        logger.warn(
          { cep: cleanCep, provider: providerName, error: (error as Error).message },
          'Falha no provedor de endereço, tentando próximo...',
        )
      }
    }

    // Se chegou aqui, todos falharam
    if (lastError instanceof InvalidCepError) {
      throw lastError
    }

    logger.error({ cep: cleanCep }, 'Todos os provedores de endereço falharam')
    throw lastError
  }

  private async saveToCache(key: string, data: AddressData) {
    try {
      await this.redis.set(key, JSON.stringify(data), 'EX', this.CACHE_TTL_SECONDS)
    } catch (err) {
      logger.error({ error: err }, 'Erro ao salvar endereço no cache do Redis')
    }
  }
}
