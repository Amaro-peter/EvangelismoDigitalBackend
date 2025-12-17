import { PrismaChurchesRepository } from "@repositories/prisma/prisma-churches-repository";
import { FindNearestChurchesUseCase } from "@use-cases/churches/find-nearest-churches-use-case";


export function makeFindNearestChurchesUseCase() {
    const churchesRepository = new PrismaChurchesRepository()
    const findNearestChurchesUseCase = new FindNearestChurchesUseCase(churchesRepository)

    return findNearestChurchesUseCase
}