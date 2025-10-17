import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function seed() {
  console.log('🌱 Iniciando seed...')

  // --- 1️⃣ Cria o usuário admin se não existir ---
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      publicId: '0197f9cb-e9dd-72f2-8bea-863124fbec4c',
      name: 'Admin User',
      username: 'Admin',
      email: 'admin@example.com',
      cpf: '111.111.111-11',
      passwordHash: '$2a$12$y7AWvv8D1P9AVn2G8XkNZOXyrMZ658QFJyR.2kxM.oP/wmgB/.7.2',
      role: 'ADMIN',
    },
  })

  console.log('👤 Usuário admin criado/verificado.')

  // --- 2️⃣ Carrega a lista de igrejas ---
  const filePath = path.resolve(__dirname, '../src/data/churches.json')

  if (!fs.existsSync(filePath)) {
    console.warn('⚠️ Nenhum arquivo churches.json encontrado. Pulando seed de igrejas.')
    return
  }

  const rawData = fs.readFileSync(filePath, 'utf-8')
  const churches = JSON.parse(rawData)

  console.log(`📖 ${churches.length} igrejas encontradas no arquivo.`)

  // --- 3️⃣ Seed otimizado das igrejas ---
  const batchSize = 500 // define o tamanho dos lotes
  let totalInserted = 0

  for (let i = 0; i < churches.length; i += batchSize) {
    const batch = churches.slice(i, i + batchSize)

    // Cria um único INSERT com todos os registros do lote
    const values = batch
      .map(
        (c: any) =>
          `(${prisma.$escape(c.name)}, ${prisma.$escape(c.address)}, ${c.lat}, ${c.lon}, ST_SetSRID(ST_MakePoint(${c.lon}, ${c.lat}), 4326))`,
      )
      .join(',')

    // Executa o insert em lote via SQL direto
    await prisma.$executeRawUnsafe(`
      INSERT INTO churches (name, address, lat, lon, geog)
      VALUES ${values};
    `)

    totalInserted += batch.length
    console.log(`✅ Inseridas ${totalInserted}/${churches.length} igrejas...`)
  }

  console.log(`🌿 Seed de igrejas finalizado com sucesso! Total: ${totalInserted}`)
}

seed()
  .then(async () => {
    console.log('✅ Seeding completed successfully.')
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('❌ Error during seeding:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
