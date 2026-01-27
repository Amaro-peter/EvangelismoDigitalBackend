import { logger } from '@lib/logger'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { makeSearchUsersUseCase } from '@use-cases/factories/make-search-users-use-case'
import { FastifyReply, FastifyRequest } from 'fastify'

export async function searchUsersController(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { query, page } = request.query as { query: string; page: string }

    const searchQuery = query || ''
    const pageNumber = page ? parseInt(page, 10) : 1

    if (isNaN(pageNumber) || pageNumber < 1) {
      return reply
        .status(400)
        .send({ message: 'Número de página inválido. A página deve ser um número inteiro maior que zero.' })
    }

    const searchUsersUseCase = makeSearchUsersUseCase()

    const { users } = await searchUsersUseCase.execute({
      query: searchQuery,
      page: pageNumber,
    })

    logger.info(`Encontrados ${users.length} usuários para a consulta: "${searchQuery}" na página ${pageNumber}.`)

    return reply.status(200).send({ users })
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return reply.status(404).send({ message: 'Nenhum usuário encontrado para a consulta fornecida.' })
    }

    logger.error('Erro ao buscar usuários:')

    throw error
  }
}
