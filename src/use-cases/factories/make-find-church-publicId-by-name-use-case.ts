import { PrismaChurchesRepository } from '@repositories/prisma/prisma-churches-repository'
import { FindChurchPublicIdByNameUseCase } from '@use-cases/churches/find-church-publicId-by-name-use-case'

export function makeFindChurchPublicIdByNameUseCase() {
  const churchesRepository = new PrismaChurchesRepository()
  const findChurchPublicIdByNameUseCase = new FindChurchPublicIdByNameUseCase(churchesRepository)

  return findChurchPublicIdByNameUseCase
}