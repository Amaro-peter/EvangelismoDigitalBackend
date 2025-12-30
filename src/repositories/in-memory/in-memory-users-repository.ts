import { User } from "@prisma/client";
import { CreateUser, FindByToken, UserPasswordUpdateInput, UsersRepository, UserWhereUniqueInput } from "@repositories/users-repository";


export class InMemoryUsersRepository implements UsersRepository {
  public items: User[] = []

  async findByToken(data: FindByToken): Promise<User | null> {
    const user = this.items.find((item) => item.token === data.token)

    return user ?? null
  }

  async findBy(where: UserWhereUniqueInput): Promise<User | null> {
    const user = this.items.find(
      (item) =>
        (where.id && item.id === where.id) ||
        (where.publicId && item.publicId === where.publicId) ||
        (where.email && item.email === where.email) ||
        (where.username && item.username === where.username) ||
        (where.cpf && item.cpf === where.cpf),
    )

    return user ?? null
  }

  async search(query: string, page: number): Promise<User[]> {
    return this.items
      .filter(
        (item) =>
          item.name.toLowerCase().includes(query.toLowerCase()) ||
          item.email.toLowerCase().includes(query.toLowerCase()),
      )
      .slice((page - 1) * 20, page * 20)
  }

  async create(data: CreateUser): Promise<User> {
    const now = new Date()
    const user = {
      id: this.items.length + 1,
      publicId: (data as any).publicId || crypto.randomUUID(),
      name: (data as any).name,
      email: (data as any).email,
      username: (data as any).username,
      passwordHash: (data as any).passwordHash,
      photo: (data as any).photo ?? null,
      cpf: (data as any).cpf,
      loginAttempts: (data as any).loginAttempts ?? 0,
      lastLogin: (data as any).lastLogin ? new Date((data as any).lastLogin as any) : null,
      role: (data as any).role ?? 'DEFAULT',
      resetToken: null,
      resetExpiresAt: null,
      token: null,
      tokenExpiresAt: (data as any).tokenExpiresAt ? new Date((data as any).tokenExpiresAt as any) : null,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: (data as any).passwordChangedAt ? new Date((data as any).passwordChangedAt as any) : null,
    } as any as User

    this.items.push(user)
    return user
  }

  async list(): Promise<User[]> {
    return this.items
  }

  async delete(publicId: string): Promise<User> {
    const userIndex = this.items.findIndex((item) => item.publicId === publicId)
    if (userIndex === -1) {
      throw new Error('User not found')
    }
    const [deletedUser] = this.items.splice(userIndex, 1)
    return deletedUser
  }

  async update(publicId: string, data: { name: string, email: string, username: string }): Promise<User | null> {
    const userIndex = this.items.findIndex((item) => item.publicId === publicId)
    if (userIndex === -1) {
      return null
    }
    const existingUser = this.items[userIndex]
    const updatedUser = {
      ...existingUser,
      ...data,
      updatedAt: new Date(),
    }
    this.items[userIndex] = updatedUser
    return updatedUser
  }

  async updatePassword(publicId: string, data: UserPasswordUpdateInput): Promise<User | null> {
    const userIndex = this.items.findIndex((item) => item.publicId === publicId)
    if (userIndex === -1) {
      return null
    }
    const existingUser = this.items[userIndex]
    const updatedUser = {
      ...existingUser,
      ...data,
    }
    this.items[userIndex] = updatedUser
    return updatedUser
  }
}