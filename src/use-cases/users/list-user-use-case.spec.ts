import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { GetUserProfileUseCase } from './get-user-profile'
import { ListUsersUseCase } from './list-users'

describe('List Users Use Case', () => {
  it('should throw ResourceNotFoundError if list of users does not exist', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const listUsersUseCase = new ListUsersUseCase(usersRepository)

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

      const listSpy = vi.spyOn(usersRepository, 'list').mockResolvedValue(null as any)

      await expect(() => listUsersUseCase.execute()).rejects.toBeInstanceOf(ResourceNotFoundError)

      listSpy.mockRestore()
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw ResourceNotFoundError if list of users is equal to zero', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const listUsersUseCase = new ListUsersUseCase(usersRepository)

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

      const listSpy = vi.spyOn(usersRepository, 'list').mockResolvedValue(0 as number as any)

      await expect(() => listUsersUseCase.execute()).rejects.toBeInstanceOf(ResourceNotFoundError)

      listSpy.mockRestore()
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should be able to get a list of users', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const listUsersUseCase = new ListUsersUseCase(usersRepository)

      const firstEmail = `johndoe${Date.now()}@gmail.com`
      const firstUsername = 'johndoe'
      const firstCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      const { user: user1 } = await registerUseCase.execute({
        name: 'John Doe',
        email: firstEmail,
        cpf: firstCpf,
        password,
        username: firstUsername,
        role: UserRole.DEFAULT,
      })

      const secondEmail = `janedoe${Date.now()}@gmail.com`
      const secondUsername = 'janedoe'
      const secondCpf = cpfValidator.generate()

      const { user: user2 } = await registerUseCase.execute({
        name: 'Jane Doe',
        email: secondEmail,
        cpf: secondCpf,
        password,
        username: secondUsername,
        role: UserRole.DEFAULT,
      })

      const usersList = await listUsersUseCase.execute()

      expect(usersList.users).toHaveLength(2)
      expect(usersList.users).toEqual(expect.arrayContaining([user1, user2]))
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
