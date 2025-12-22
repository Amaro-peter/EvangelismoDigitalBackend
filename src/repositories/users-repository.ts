import { Prisma, User } from '@prisma/client'

export interface UserPasswordUpdateInput {
  passwordHash?: string
  token?: string | null
  tokenExpiresAt?: Date | null
  passwordChangedAt?: Date | null
  updatedAt?: Date
}

export interface FindByToken {
  token: string
}

export interface UsersRepository {
  create(data: Prisma.UserCreateInput): Promise<User>
  findByEmail(email: string): Promise<User | null>
  findByToken(token: FindByToken): Promise<User | null>
  findBy(where: Prisma.UserWhereUniqueInput): Promise<User | null>
  list(): Promise<User[]>
  update(publicId: string, data: Prisma.UserUpdateInput): Promise<User | null>
  updatePassword(publicId: string, data: UserPasswordUpdateInput): Promise<User | null>
  delete(publicId: string): Promise<User>
}
