import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ForgotPasswordUseCase } from './forgot-password'
import { UserNotFoundForPasswordResetError } from '@use-cases/errors/user-not-found-for-password-reset-error'

describe('Forgot Password Use Case', () => {
  it('should throw UserNotFoundForPasswordResetError when user is not found by email', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()
      const password = 'Teste123x!'

       await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const findSpy = vi.spyOn(usersRepository, 'findBy').mockReturnValueOnce(null as any)

      await expect(() => 
        forgotPasswordUseCase.execute({ email: uniqueEmail })
      ).rejects.toBeInstanceOf(UserNotFoundForPasswordResetError)

      findSpy.mockRestore()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it("should generate a password reset token and expiration time for the same token", async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()
      const password = 'Teste123x!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const before = Date.now()
      const { user, token } = await forgotPasswordUseCase.execute({
        email: uniqueEmail,
      })
      const after = Date.now()

      expect(user.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)

      expect(token).toHaveLength(64)
      expect(user.token).toBe(token)

      if(user.tokenExpiresAt) {
        const expiresAt = new Date(user.tokenExpiresAt).getTime()
        const expectedMin = before + 15 * 60 * 1000
        const expectedMax = after + 15 * 60 * 1000
        expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 1000)
        expect(expiresAt).toBeLessThanOrEqual(expectedMax + 1000)
      } else {
        throw new Error('tokenExpiresAt is not set')
      }

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw UserNotFoundForPasswordResetError when user is not updated', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()
      const password = 'Teste123x!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const updatePasswordSpy = vi.spyOn(usersRepository, 'updatePassword').mockReturnValueOnce(null as any)

      await expect(() => forgotPasswordUseCase.execute({ email: uniqueEmail })).rejects.toBeInstanceOf(
        UserNotFoundForPasswordResetError,
      )

      updatePasswordSpy.mockRestore()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

})
