import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { compare } from 'bcryptjs'
import { UserRole } from '@repositories/users-repository'
import { AuthenticateUserUseCase } from './authenticate-user'
import { InvalidCredentialsError } from '@use-cases/errors/invalid-credentials-error'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'

describe('Authenticate User Use Case', () => {
  it('should be able to find a user by email', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const authenticateUserUseCase = new AuthenticateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      const { user } = await authenticateUserUseCase.execute({
        login: uniqueEmail,
        password,
      })

      expect(user.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should be able to find a user by username', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const authenticateUserUseCase = new AuthenticateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      const { user } = await authenticateUserUseCase.execute({
        login: username,
        password,
      })

      expect(user.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it("should compare user's password upon authentication", async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const authenticateUserUseCase = new AuthenticateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      const { user } = await authenticateUserUseCase.execute({
        login: uniqueEmail,
        password,
      })

      const isPasswordCorrectlyHashed = await compare(password, user.passwordHash)

      expect(isPasswordCorrectlyHashed).toBe(true)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to register with invalid email', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const authenticateUserUseCase = new AuthenticateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      const invalidEmail = 'invalid-email@gmail.com'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      await expect(() =>
        authenticateUserUseCase.execute({
          login: invalidEmail,
          password,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to register with invalid username', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const authenticateUserUseCase = new AuthenticateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      const invalidUsername = 'invalid-username'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      await expect(() =>
        authenticateUserUseCase.execute({
          login: invalidUsername,
          password,
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
