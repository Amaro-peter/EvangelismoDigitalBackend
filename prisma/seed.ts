import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function seed() {
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      publicId: '0197f9cb-e9dd-72f2-8bea-863124fbec4c',
      name: 'Admin User',
      username: 'Admin',
      email: 'admin@example.com',
      cpf: '111.111.111-11',
      // password: 'ybp_whf3wxn2xdr6MTE'
      passwordHash: '$2a$12$y7AWvv8D1P9AVn2G8XkNZOXyrMZ658QFJyR.2kxM.oP/wmgB/.7.2',
      role: 'ADMIN',
    },
  })
}

seed()
  .then(() => {
    console.log('Seeding completed successfully.')
    prisma.$disconnect()
    process.exit(0)
  })
  .catch((error) => {
    console.error('Error during seeding:', error)
    prisma.$disconnect()
    process.exit(1)
  })
