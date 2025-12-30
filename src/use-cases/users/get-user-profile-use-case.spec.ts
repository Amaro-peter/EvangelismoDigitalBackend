import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserRole } from '@repositories/users-repository'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'
import { GetUserProfileUseCase } from './get-user-profile'

describe('Get User Profile Use Case', () => {
  it('should throw ResourceNotFoundError if user does not exist', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const getUserProfileUseCase = new GetUserProfileUseCase(usersRepository)

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
        getUserProfileUseCase.execute({
          publicId: user.publicId,
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError)

      findSpy.mockRestore()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should be able to get a user profile by publicId', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const getUserProfileUseCase = new GetUserProfileUseCase(usersRepository)

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

      const { user: userProfile } = await getUserProfileUseCase.execute({
        publicId: user.publicId,
      })

      expect(userProfile).toBe(user)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not get userprofile1 based on userProfile2', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const getUserProfileUseCase = new GetUserProfileUseCase(usersRepository)

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

      const { user: userProfile1 } = await getUserProfileUseCase.execute({
        publicId: user1.user.publicId,
      })

      const { user: userProfile2 } = await getUserProfileUseCase.execute({
        publicId: user2.user.publicId,
      })

      expect(userProfile1).not.toBe(userProfile2)
    
      expect(userProfile1?.publicId).toBe(user1.user.publicId)

      expect(userProfile2?.publicId).toBe(user2.user.publicId)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw ResourceNotFoundError when getting profile with invalid publicId', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const getUserProfileUseCase = new GetUserProfileUseCase(usersRepository)

      await expect(
        getUserProfileUseCase.execute({
          publicId: 'non-existent-public-id',
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })
})
