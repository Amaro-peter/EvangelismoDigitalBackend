import { prisma } from "@lib/prisma";
import { Prisma } from '@prisma/client'
import { FormsRepository } from '@repositories/forms-repository'

export class PrismaFormsRepository implements FormsRepository {
  async create(data: Prisma.FormSubmissionCreateInput) {
    return await prisma.formSubmission.create({
      data,
    })
  }
}