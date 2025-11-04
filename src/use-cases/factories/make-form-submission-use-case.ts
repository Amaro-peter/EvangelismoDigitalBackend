import { PrismaFormsRepository } from '@repositories/prisma/prisma-forms-repository'
import { FormsSubmissionUseCase } from '@use-cases/forms/forms-submission'
import { RegisterUserUseCase } from '@use-cases/users/register-user'

export function makeFormSubmissionUseCase() {
  const formSubmissionRepository = new PrismaFormsRepository()
  const formSubmissionUseCase = new FormsSubmissionUseCase(formSubmissionRepository)

  return formSubmissionUseCase
}
