import { Prisma } from '@prisma/client'

export interface FormsRepositoryData {
    name: string
    email: string
    decisaoPorCristo: boolean
    location: string | null
}

export interface FormsRepository {
  create(data: FormsRepositoryData): Promise<FormSubmission>
}