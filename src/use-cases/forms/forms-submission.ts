import { FormsRepository } from '@repositories/forms-repository'
import { FormSubmission } from '@prisma/client'
import { FormSubmissionError } from '@use-cases/errors/form-submission-error'

interface FormsSubmissionUseCaseRequest {
  name: string
  lastName: string
  email: string
  decisaoPorCristo: boolean
  location?: string
}

interface FormsSubmissionUseCaseResponse {
  formSubmission: FormSubmission
}

export class FormsSubmissionUseCase {
  constructor(private formsSubmissionRepository: FormsRepository) {}

  async execute({
    name,
    lastName,
    email,
    decisaoPorCristo,
    location,
  }: FormsSubmissionUseCaseRequest): Promise<FormsSubmissionUseCaseResponse> {
    const formSubmission = await this.formsSubmissionRepository.create({
      name,
      lastName,
      email,
      decisaoPorCristo,
      location: location || null,
    } as any)

    if (!formSubmission) {
      throw new FormSubmissionError()
    }

    return { formSubmission }
  }
}
