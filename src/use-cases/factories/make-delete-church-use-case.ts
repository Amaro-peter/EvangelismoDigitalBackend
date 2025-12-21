import { PrismaChurchesRepository } from '@repositories/prisma/prisma-churches-repository'
import { DeleteChurchUseCase } from '@use-cases/churches/delete-church-use-case'

export function makeDeleteChurchUseCase() {
  const churchesRepository = new PrismaChurchesRepository()
  const deleteChurchUseCase = new DeleteChurchUseCase(churchesRepository)

  return deleteChurchUseCase
}
