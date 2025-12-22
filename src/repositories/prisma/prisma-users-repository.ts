import { prisma } from '@lib/prisma'
import { Prisma } from '@prisma/client'
import { FindByToken, UserPasswordUpdateInput, UsersRepository } from '@repositories/users-repository'

export class PrismaUsersRepository implements UsersRepository {
  async create(data: Prisma.UserCreateInput) {
    return await prisma.user.create({ data })
  }

  async findBy(where: Prisma.UserWhereUniqueInput) {
    return await prisma.user.findUnique({
      where,
    })
  }

  async findByEmail(email: string) {
    const user = await prisma.user.findUnique({
      where: {
        email: email,
      },
    })

    return user
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

  async update(publicId: string, data: Prisma.UserUpdateInput) {
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
