import { InMemoryUsersRepository } from '@repositories/in-memory/in-memory-users-repository'
import { describe, it, expect, vi } from 'vitest'
import { RegisterUserUseCase } from './register-user'
import { UserAlreadyExistsError } from '@use-cases/errors/user-already-exists-error'
import { UserRole } from '@repositories/users-repository'
import { UpdateUserUseCase } from './update-user'
import { cpf as cpfValidator } from 'cpf-cnpj-validator'
import { ResourceNotFoundError } from '@use-cases/errors/resource-not-found-error'

describe('Update Use Case', () => {

    it('should throw ResourceNotFoundError when no user is found with the given publicId', async () => {
      try {
        const usersRepository = new InMemoryUsersRepository()
        const registerUseCase = new RegisterUserUseCase(usersRepository)

        const newEmail = `janedoe${Date.now()}@gmail.com`
        const newCpf = cpfValidator.generate()
        const newUsername = 'janedoe'
        const password = 'Teste123!!'

        const { user } = await registerUseCase.execute({
          name: 'Jane Doe',
          email: newEmail,
          cpf: newCpf,
          password,
          username: newUsername,
          role: UserRole.DEFAULT,
        })

        const updateSpy = vi.spyOn(usersRepository, 'findBy').mockResolvedValueOnce(null)
        const updateUserUseCase = new UpdateUserUseCase(usersRepository)

        await expect(() =>
          updateUserUseCase.execute({
            publicId: user.publicId,
            name: 'Jane Doe Updated',
          }),
        ).rejects.toThrow(ResourceNotFoundError)

        updateSpy.mockRestore()
      } catch (error) {
        console.log('ERROR: ', error)
        throw error
      }
    })

  it('should be able to update', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const updateUserUseCase = new UpdateUserUseCase(usersRepository)

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newCpf = cpfValidator.generate()
      const newUsername = 'janedoe'

      const password = 'Teste123!!'

      const { user } = await registerUseCase.execute({
        name: 'Jane Doe',
        email: newEmail,
        cpf: newCpf,
        password,
        username: newUsername,
        role: UserRole.DEFAULT,
      })

      const updatedName = 'Jane Doe Updated'
      const updatedEmail = `janedoeupdated${Date.now()}@gmail.com`
      const updatedUsername = 'janedoeupdated'

      const { user: updatedUser } = await updateUserUseCase.execute({
        publicId: user.publicId,
        name: updatedName,
        email: updatedEmail,
        username: updatedUsername,
      })

      expect(updatedUser.publicId).toBe(user.publicId)
      expect(updatedUser.name).toBe(updatedName)
      expect(updatedUser.email).toBe(updatedEmail)
      expect(updatedUser.username).toBe(updatedUsername)
    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it("should not be able to proceed if User is not found by publicId", async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const updateUserUseCase = new UpdateUserUseCase(usersRepository)

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

      await expect(() => 
        updateUserUseCase.execute({
            publicId: 'non-existing-public-id',
            name: 'Jane Doe',
        })
      ).rejects.toBeInstanceOf(ResourceNotFoundError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to update with email used by another user', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const updateUserUseCase = new UpdateUserUseCase(usersRepository)

      const repeatedEmail = `johndoe@gmail.com`
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: repeatedEmail,
        cpf: uniqueCpf,
        password,
        username: 'johndoe',
        role: UserRole.DEFAULT,
      })

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newCpf = cpfValidator.generate()
      const newUsername = 'janedoe'

      const { user } = await registerUseCase.execute({
        name: 'Jane Doe',
        email: newEmail,
        cpf: newCpf,
        password,
        username: newUsername,
        role: UserRole.DEFAULT,
      })

      await expect(() =>
        updateUserUseCase.execute({
            publicId: user.publicId,
            name: 'Jane Doe Updated',
            email: repeatedEmail,
        })
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should not be able to update with username used by another user', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)
      const updateUserUseCase = new UpdateUserUseCase(usersRepository)

      const uniqueEmail = `johndoe@gmail.com`
      const repeatedUsername = 'johndoe'
      const uniqueCpf = cpfValidator.generate()

      const password = 'Teste123!!'

      await registerUseCase.execute({
        name: 'John Doe',
        email: uniqueEmail,
        cpf: uniqueCpf,
        password,
        username: repeatedUsername,
        role: UserRole.DEFAULT,
      })

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newCpf = cpfValidator.generate()
      const newUsername = 'janedoe'

      const { user } = await registerUseCase.execute({
        name: 'Jane Doe',
        email: newEmail,
        cpf: newCpf,
        password,
        username: newUsername,
        role: UserRole.DEFAULT,
      })

      await expect(() =>
        updateUserUseCase.execute({
          publicId: user.publicId,
          name: 'Jane Doe Updated',
          email: uniqueEmail,
          username: repeatedUsername,
        }),
      ).rejects.toBeInstanceOf(UserAlreadyExistsError)

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should throw when update operation fails unexpectedly', async () => {
    try {
      const usersRepository = new InMemoryUsersRepository()
      const registerUseCase = new RegisterUserUseCase(usersRepository)

      const newEmail = `janedoe${Date.now()}@gmail.com`
      const newCpf = cpfValidator.generate()
      const newUsername = 'janedoe'
      const password = 'Teste123!!'

      const { user } = await registerUseCase.execute({
        name: 'Jane Doe',
        email: newEmail,
        cpf: newCpf,
        password,
        username: newUsername,
        role: UserRole.DEFAULT,
      })

      const updateSpy = vi.spyOn(usersRepository, 'update').mockResolvedValueOnce(null)
      const updateUserUseCase = new UpdateUserUseCase(usersRepository)

      await expect(() =>
        updateUserUseCase.execute({
          publicId: user.publicId,
          name: 'Jane Doe Updated',
        }),
      ).rejects.toThrow('Error updating user')

      updateSpy.mockRestore()

    } catch (error) {
      console.log('ERROR: ', error)
      throw error
    }
  })

  it('should update only the name if only name is provided', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const updateUserUseCase = new UpdateUserUseCase(usersRepository)

    const { user } = await registerUseCase.execute({
      name: 'Jane Doe',
      email: `janedoe${Date.now()}@gmail.com`,
      cpf: cpfValidator.generate(),
      password: 'Teste123!!',
      username: 'janedoe',
      role: UserRole.DEFAULT,
    })

    const newName = 'Jane Doe Updated'
    const { user: updatedUser } = await updateUserUseCase.execute({
      publicId: user.publicId,
      name: newName,
    })

    expect(updatedUser.name).toBe(newName)
    expect(updatedUser.email).toBe(user.email)
    expect(updatedUser.username).toBe(user.username)
  })

  it('should update only the email if only email is provided', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const updateUserUseCase = new UpdateUserUseCase(usersRepository)

    const { user } = await registerUseCase.execute({
      name: 'Jane Doe',
      email: `janedoe${Date.now()}@gmail.com`,
      cpf: cpfValidator.generate(),
      password: 'Teste123!!',
      username: 'janedoe',
      role: UserRole.DEFAULT,
    })

    const newEmail = `janedoeupdated${Date.now()}@gmail.com`
    const { user: updatedUser } = await updateUserUseCase.execute({
      publicId: user.publicId,
      email: newEmail,
    })

    expect(updatedUser.email).toBe(newEmail)
    expect(updatedUser.name).toBe(user.name)
    expect(updatedUser.username).toBe(user.username)
  })

  it('should update only the username if only username is provided', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const updateUserUseCase = new UpdateUserUseCase(usersRepository)

    const { user } = await registerUseCase.execute({
      name: 'Jane Doe',
      email: `janedoe${Date.now()}@gmail.com`,
      cpf: cpfValidator.generate(),
      password: 'Teste123!!',
      username: 'janedoe',
      role: UserRole.DEFAULT,
    })

    const newUsername = 'janedoeupdated'
    const { user: updatedUser } = await updateUserUseCase.execute({
      publicId: user.publicId,
      username: newUsername,
    })

    expect(updatedUser.username).toBe(newUsername)
    expect(updatedUser.name).toBe(user.name)
    expect(updatedUser.email).toBe(user.email)
  })

  it('should not update if no fields are provided', async () => {
    const usersRepository = new InMemoryUsersRepository()
    const registerUseCase = new RegisterUserUseCase(usersRepository)
    const updateUserUseCase = new UpdateUserUseCase(usersRepository)

    const { user } = await registerUseCase.execute({
      name: 'Jane Doe',
      email: `janedoe${Date.now()}@gmail.com`,
      cpf: cpfValidator.generate(),
      password: 'Teste123!!',
      username: 'janedoe',
      role: UserRole.DEFAULT,
    })

    const { user: updatedUser } = await updateUserUseCase.execute({
      publicId: user.publicId,
    })

    expect(updatedUser.publicId).toBe(user.publicId)
    expect(updatedUser.name).toBe(user.name)
    expect(updatedUser.email).toBe(user.email)
    expect(updatedUser.username).toBe(user.username)
  })
})
