import { DatabaseContext } from '@lib/prisma/helpers/database-context'
import { Prisma } from '@prisma/client'
import { FormsRepository } from 'core/contracts/repository/forms-repository'

export class PrismaFormsRepository implements FormsRepository {
  constructor(private readonly dbContext: DatabaseContext) {}

  async create(data: Prisma.FormSubmissionCreateInput) {
    return await this.dbContext.client.formSubmission.create({
      data,
    })
  }

  async findByEmail(email: string) {
    return await this.dbContext.client.formSubmission.findUnique({
      where: {
        email,
      },
    })
  }
}
