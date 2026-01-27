import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { compare } from 'bcryptjs'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { UserNotCreatedError } from '@use-cases/errors/user-not-created-error'
import { Prisma } from '@prisma/client'

describe('Register Use Case', () => {
  it('should be able to register', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      const { user } = await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      expect(user.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it("should hash user's password upon registration", async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      const { user } = await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const isPasswordCorrectlyHashed = await compare(password, user.passwordHash)

      expect(isPasswordCorrectlyHashed).toBe(true)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to register with the same email twice', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `johndoe@gmail.com`
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const newCpf = cpfValidator.generate()
      const newUsername = 'janedoe'

      await expect(() =>
        registerUseCase.execute({
          name: 'John Doe',
          email: uniqueEmail,
          cpf: newCpf,
          password,
          username: newUsername,
          role: UserRole.DEFAULT,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to register with the same CPF twice', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = `316.526.750-27`

      const password = 'Teste123!!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newUsername = 'janedoe'

      await expect(() =>
        registerUseCase.execute({
          name: 'Jane Doe',
          email: newEmail,
          cpf: uniqueCpf,
          password,
          username: newUsername,
          role: UserRole.DEFAULT,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to register with the same username twice', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      const username = 'johndoe'

      await registerUseCase.execute({
        name: 'Jane Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newCpf = cpfValidator.generate()

      await expect(() =>
        registerUseCase.execute({
          name: 'John Doe',
          email: newEmail,
          cpf: newCpf,
          password,
          username: username,
          role: UserRole.DEFAULT,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw UserNotCreatedError if user is not created', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      vi.spyOn(usersRepository, 'create').mockResolvedValueOnce(null as any)

      await expect(() =>
        registerUseCase.execute({
          name: 'Test',
          email: `test${Date.now()}@example.com`,
          cpf: '123.456.789-00',
          password: 'Password123!',
          username: 'testuser',
          role: UserRole.DEFAULT,
        }),
      ).rejects.toBeInstanceOf(UserNotCreatedError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw UserAlreadyExistsError if Prisma error P2002 occurs', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        { code: 'P2002', clientVersion: '4.0.0' } as any,
      )

      vi.spyOn(usersRepository, 'findBy').mockResolvedValue(null)
      vi.spyOn(usersRepository, 'create').mockRejectedValueOnce(prismaError)

      await expect(() =>
        registerUseCase.execute({
          name: 'Test',
          email: `test${Date.now()}@example.com`,
          cpf: '123.456.789-00',
          password: 'Password123!',
          username: 'testuser',
          role: UserRole.DEFAULT,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw error if repository throws unexpected error', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      vi.spyOn(usersRepository, 'findBy').mockResolvedValueOnce(null)
      vi.spyOn(usersRepository, 'findBy').mockResolvedValueOnce(null)
      vi.spyOn(usersRepository, 'findBy').mockResolvedValueOnce(null)
      vi.spyOn(usersRepository, 'create').mockRejectedValueOnce(new Error('Unexpected'))

      await expect(() =>
        registerUseCase.execute({
          name: 'Test',
          email: `test${Date.now()}@example.com`,
          cpf: '123.456.789-00',
          password: 'Password123!',
          username: 'testuser',
          role: UserRole.DEFAULT,
        }),
      ).rejects.toThrow('Unexpected')
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should register user with ADMIN role', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const uniqueEmail = `admin${Date.now()}@gmail.com`
      const uniqueCpf = cpfValidator.generate()
      const password = 'Admin123!'

      const { user } = await registerUseCase.execute({
        name: 'Admin User',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: 'adminuser',
        role: UserRole.ADMIN,
      })

      expect(user.role).toBe(UserRole.ADMIN)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
