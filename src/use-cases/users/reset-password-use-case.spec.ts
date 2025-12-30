import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { compare } from 'bcryptjs'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ForgotPasswordUseCase } from './forgot-password'
import { ResetPasswordUseCase } from './reset-password'
import { InvalidTokenError } from '@use-cases/errors/invalid-token-error'

describe('Reset Password Use Case', () => {
  it('should throw InvalidTokenError when user is not found by token', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)
      const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

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

      await forgotPasswordUseCase.execute({
        email: uniqueEmail,
      })

      await expect(() => resetPasswordUseCase.execute({ 
        token: 'some-token', 
        password: 'newPassword123!' 
      })).rejects.toBeInstanceOf(
        InvalidTokenError,
      )

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw InvalidTokenError when tokenExpiresAt does not exist', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)
      const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

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

      const {token, user} = await forgotPasswordUseCase.execute({
        email: uniqueEmail,
      })

      await usersRepository.updatePassword(user.publicId, {
        tokenExpiresAt: null,
      })

      await expect(() =>
        resetPasswordUseCase.execute({
          token: token,
          password: 'newPassword123!',
        }),
      ).rejects.toBeInstanceOf(InvalidTokenError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw InvalidTokenError when tokenExpiresAt is in the past', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)
      const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

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

      const { token, user } = await forgotPasswordUseCase.execute({
        email: uniqueEmail,
      })

      await usersRepository.updatePassword(user.publicId, {
        tokenExpiresAt: new Date(Date.now() - 1000 * 60 * 60),
      })

      await expect(() =>
        resetPasswordUseCase.execute({
          token: token,
          password: 'newPassword123!',
        }),
      ).rejects.toBeInstanceOf(InvalidTokenError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it("should reset user password", async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)
      const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

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

      const { token } = await forgotPasswordUseCase.execute({
        email: uniqueEmail,
      })

      const before = Date.now()

      const { user } = await resetPasswordUseCase.execute({
        token,
        password: 'newPassword123!',
      })

      const after = Date.now()

      if(user.passwordChangedAt && user.updatedAt) {
        const passWordChangedAt = new Date(user.passwordChangedAt).getTime()

        expect(passWordChangedAt).toBeGreaterThanOrEqual(before)
        expect(passWordChangedAt).toBeLessThanOrEqual(after)

        const updatedAt = new Date(user.updatedAt).getTime()

        expect(updatedAt).toBeGreaterThanOrEqual(before)
        expect(updatedAt).toBeLessThanOrEqual(after)

      } else {
        throw new Error('passwordChangedAt is not set')
      }

      const isPasswordCorrectlyHashed = await compare('newPassword123!', user.passwordHash)

      expect(isPasswordCorrectlyHashed).toBe(true)

      expect(user.token).toBeNull()
      expect(user.tokenExpiresAt).toBeNull()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
   
  it('should throw Error when user password is not updated', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const forgotPasswordUseCase = new ForgotPasswordUseCase(usersRepository)
      const resetPasswordUseCase = new ResetPasswordUseCase(usersRepository)

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

        const { token } = await forgotPasswordUseCase.execute({
        email: uniqueEmail,
        })

        const resetSpy = vi.spyOn(usersRepository, 'updatePassword').mockReturnValueOnce(null as any)

        await expect(() =>
            resetPasswordUseCase.execute({
                token,
                password: 'newPassword123!',
            })
        ).rejects.toThrowError('Failed to update user')

        resetSpy.mockRestore()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
