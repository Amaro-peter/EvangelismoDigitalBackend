import { FormSubmission } from '@prisma/client'

export interface FormSubmissionData {
  name: string
  lastName: string
  email: string
  decisaoPorCristo: boolean
  location?: string
}

export interface FormsRepository {
  create(data: FormSubmissionData): Promise<FormSubmission>
  findByEmail(email: string): Promise<FormSubmission | null>
}
