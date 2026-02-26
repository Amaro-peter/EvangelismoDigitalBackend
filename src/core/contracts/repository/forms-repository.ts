import { FormSubmission, Prisma } from '@prisma/client'

export interface FormsRepository {
  create(data: Prisma.FormSubmissionCreateInput): Promise<FormSubmission>
  findByEmail(email: string): Promise<FormSubmission | null>
}
