import { prisma } from '@lib/prisma'
import { Prisma, User } from '@prisma/client'
import {
  CreateUser,
  FindByToken,
  UserPasswordUpdateInput,
  UsersRepository,
  UserUpdateInput,
  UserWhereUniqueInput,
} from '@repositories/users-repository'

export class PrismaUsersRepository implements UsersRepository {
  async create(data: CreateUser) {
    return await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        cpf: data.cpf,
        username: data.username,
        passwordHash: data.passwordHash,
        role: data.role,
      },
    })
  }

  async findBy(where: UserWhereUniqueInput) {
    const prismaWhere = {} as Prisma.UserWhereUniqueInput

    if (where.id !== undefined) prismaWhere.id = where.id
    if (where.publicId !== undefined) prismaWhere.publicId = where.publicId
    if (where.email !== undefined) prismaWhere.email = where.email
    if (where.username !== undefined) prismaWhere.username = where.username
    if (where.cpf !== undefined) prismaWhere.cpf = where.cpf
    if (where.token !== undefined) prismaWhere.token = where.token

    return await prisma.user.findUnique({
      where: prismaWhere,
    })
  }

  async findByToken({ token }: FindByToken) {
    return await prisma.user.findFirst({
      where: {
        token,
      },
    })
  }

  async list() {
    return await prisma.user.findMany()
  }

  async search(query: string, page: number): Promise<User[]> {
    const users = await prisma.user.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive',
        },
      },
      skip: (page - 1) * 20,
      take: 20,
    })

    return users
  }

  async update(publicId: string, data: UserUpdateInput) {
    return await prisma.user.update({
      where: { publicId },
      data,
    })
  }

  async updatePassword(publicId: string, data: UserPasswordUpdateInput) {
    return await prisma.user.update({
      where: { publicId },
      data,
    })
  }

  async delete(publicId: string) {
    return await prisma.user.delete({
      where: {
        publicId,
      },
    })
  }
}
