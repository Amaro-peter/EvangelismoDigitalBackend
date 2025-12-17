import { PrismaChurchesRepository } from "@repositories/prisma/prisma-churches-repository";
import { CreateChurchUseCase } from "@use-cases/churches/create-church-use-case";

export function makeCreateChurchUseCase() {
    const churchesRepository = new PrismaChurchesRepository()
    const createChurchUseCase = new CreateChurchUseCase(churchesRepository)

    return createChurchUseCase
}