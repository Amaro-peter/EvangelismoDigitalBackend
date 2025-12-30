import { describe, it, expect, vi, afterEach } from 'vitest'
import { FormsSubmissionUseCase } from './forms-submission'
import { InMemoryFormsSubmissionRepository } from '@repositories/in-memory/in-memory-forms-submission-repository'
import { FormSubmissionError } from '@use-cases/errors/form-submission-error'

describe('Forms Submission Use Case', async () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it('should create a form submission successfully', async () => {
        const formsRepository = new InMemoryFormsSubmissionRepository()
        const formsSubmissionUseCase = new FormsSubmissionUseCase(formsRepository)

        const data = {
            name: 'John Doe',
            lastName: 'Smith',
            email: 'test@example.com',
            decisaoPorCristo: true,
            location: 'New York',
        }

        const { formSubmission } = await formsSubmissionUseCase.execute(data)

        expect(formSubmission).toMatchObject({
            name: data.name,
            lastName: data.lastName,
            email: data.email,
            decisaoPorCristo: data.decisaoPorCristo,
            location: data.location,
        })

        expect(formSubmission.id).toBeDefined()
        expect(formSubmission.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
        expect(formSubmission.createdAt).toBeInstanceOf(Date)
    })

    it('should set location to null if not provided', async () => {
      const formsRepository = new InMemoryFormsSubmissionRepository()
      const useCase = new FormsSubmissionUseCase(formsRepository)

      const data = {
        name: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
        decisaoPorCristo: false,
      }

      const { formSubmission } = await useCase.execute(data)

      expect(formSubmission.location).toBeNull()
    })

    
    it('should throw FormSubmissionError if repository returns null', async () => {
      const formsRepository = new InMemoryFormsSubmissionRepository()
      vi.spyOn(formsRepository, 'create').mockResolvedValueOnce(null as any)
      const useCase = new FormsSubmissionUseCase(formsRepository)

      await expect(() =>
        useCase.execute({
          name: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          decisaoPorCristo: true,
        }),
      ).rejects.toBeInstanceOf(FormSubmissionError)
    })

})