import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { DeleteUserUseCase } from './delete-user'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

describe('Delete User Use Case', () => {
  it('should throw ResourceNotFoundError if user does not exist', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const deleteUserUseCase = new DeleteUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      const { user } = await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      const findSpy = vi.spyOn(usersRepository, 'findBy').mockResolvedValue(null)

      await expect(() =>
        deleteUserUseCase.execute({
          publicId: user.publicId,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError)

      findSpy.mockRestore()
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should be able to delete a user by publicId', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const deleteUserUseCase = new DeleteUserUseCase(usersRepository)

      const uniqueEmail = `johndoe${Date.now()}@gmail.com`
      const username = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123x!'

      const { user } = await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: username,
        role: UserRole.DEFAULT,
      })

      await expect(
        deleteUserUseCase.execute({
          publicId: user.publicId,
        }),
      ).resolves.toBeUndefined()

      const found = await usersRepository.findBy({
        publicId: user.publicId,
      })

      expect(found).toBeNull()
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not delete other users when deleting by publicId', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const deleteUserUseCase = new DeleteUserUseCase(usersRepository)

      const user1 = await registerUseCase.execute({
        name: 'User One',
        email: `userone${Date.now()}@gmail.com`,
        cpf: cpfValidator.generate(),
        password: 'Password1!',
        username: 'userone',
        role: UserRole.DEFAULT,
      })

      const user2 = await registerUseCase.execute({
        name: 'User Two',
        email: `usertwo${Date.now()}@gmail.com`,
        cpf: cpfValidator.generate(),
        password: 'Password2!',
        username: 'usertwo',
        role: UserRole.DEFAULT,
      })

      await deleteUserUseCase.execute({
        publicId: user1.user.publicId,
      })

      const found1 = await usersRepository.findBy({
        publicId: user1.user.publicId,
      })

      const found2 = await usersRepository.findBy({
        publicId: user2.user.publicId,
      })

      expect(found1).toBeNull()
      expect(found2).not.toBeNull()
      expect(found2?.publicId).toBe(user2.user.publicId)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw ResourceNotFoundError when deleting with invalid publicId', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const deleteUserUseCase = new DeleteUserUseCase(usersRepository)

      await expect(
        deleteUserUseCase.execute({
          publicId: 'non-existent-public-id',
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
