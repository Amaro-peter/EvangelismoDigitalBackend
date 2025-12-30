import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { SearchUsersUseCase } from './search-users-use-case'

describe('Search Users Use Case', () => {
  it('should throw ResourceNotFoundError if search returns null', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const searchUsersUseCase = new SearchUsersUseCase(usersRepository)

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

    const searchSpy = vi.spyOn(usersRepository, 'search').mockResolvedValue(null as any)

    await expect(() => searchUsersUseCase.execute({ query: 'john', page: 1 })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    )

    searchSpy.mockRestore()
  })

  it('should throw ResourceNotFoundError if search returns empty array', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const searchUsersUseCase = new SearchUsersUseCase(usersRepository)

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

    const searchSpy = vi.spyOn(usersRepository, 'search').mockResolvedValue([])

    await expect(() => searchUsersUseCase.execute({ query: 'notfound', page: 1 })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    )

    searchSpy.mockRestore()
  })

  it('should be able to search and return users', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const searchUsersUseCase = new SearchUsersUseCase(usersRepository)

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

    const result = await searchUsersUseCase.execute({ query: 'doe', page: 1 })

    expect(result.users.length).toBeGreaterThanOrEqual(2)
    expect(result.users).toEqual(expect.arrayContaining([user1, user2]))
  })
})
