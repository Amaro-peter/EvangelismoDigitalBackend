import { prisma } from "@lib/prisma";
import { FormsRepository, FormsRepositoryData } from "@repositories/forms-repository";


export class PrismaFormsRepository implements FormsRepository {
    async create(data: FormsRepositoryData) {
        return await prisma.form_submissions.create({
            data
        })
    }
}