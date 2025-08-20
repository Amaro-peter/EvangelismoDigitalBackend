import { Prisma, User } from '@prisma/client'

export interface TokenData {
  token: string | null
  tokenExpiresAt: Date | null
}

export interface UserRepository {
  create(data: Prisma.UserCreateInput): Promise<User>
  findBy(where: Prisma.UserWhereUniqueInput): Promise<User | null>
  list(): Promise<User[]>
  update(id: number, data: Prisma.UserUpdateInput): Promise<User>
  delete(id: number): Promise<User>
}
