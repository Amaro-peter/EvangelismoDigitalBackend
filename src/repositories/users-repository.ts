import { User } from '@prisma/client'

export enum UserRole {
  ADMIN = 'ADMIN',
  DEFAULT = 'DEFAULT',
}

export interface CreateUser {
  name: string
  email: string
  cpf: string
  username: string
  passwordHash: string
  role: UserRole
}

export interface UserWhereUniqueInput {
  id?: number
  publicId?: string
  email?: string
  username?: string
  cpf?: string
  token?: string
}

export interface UserPasswordUpdateInput {
  passwordHash?: string
  token?: string | null
  tokenExpiresAt?: Date | null
  passwordChangedAt?: Date | null
  updatedAt?: Date
}

export interface UserUpdateInput {
  name?: string
  email?: string
  username?: string
  cpf?: string
  updatedAt?: Date
}

export interface FindByToken {
  token: string
}

export interface UsersRepository {
  create(data: CreateUser): Promise<User | null>
  findByToken(token: FindByToken): Promise<User | null>
  findBy(where: UserWhereUniqueInput): Promise<User | null>
  list(): Promise<User[] | null>
  search(query: string, page: number): Promise<User[] | null>
  update(publicId: string, data: UserUpdateInput): Promise<User | null>
  updatePassword(publicId: string, data: UserPasswordUpdateInput): Promise<User | null>
  delete(publicId: string): Promise<User>
}
