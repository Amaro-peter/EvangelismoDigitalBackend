import { prisma } from '@lib/prisma'
import { Prisma } from '@prisma/client'
import { UserRepository } from '@repositories/users-repository'

export class PrismaUsersRepository implements UserRepository {
  async create(data: Prisma.UserCreateInput) {
    return await prisma.user.create({ data })
  }

  async findBy(where: Prisma.UserWhereUniqueInput) {
    return await prisma.user.findUnique({
      where,
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

  async delete(publicId: string) {
    return await prisma.user.delete({
      where: {
        publicId,
      },
    })
  }
}
