import { PrismaChurchesRepository } from '@repositories/prisma/prisma-churches-repository'
import { FindNearestChurchesUseCase } from '@use-cases/churches/find-nearest-churches-use-case'

let cachedUseCase: FindNearestChurchesUseCase | null = null

export function makeFindNearestChurchesUseCase() {
  if (cachedUseCase) {
    return cachedUseCase
  }

  const churchesRepository = new PrismaChurchesRepository()
  cachedUseCase = new FindNearestChurchesUseCase(churchesRepository)

  return cachedUseCase
}
