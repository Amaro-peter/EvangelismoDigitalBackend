import { execSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Environment } from "vitest/environments"
import { prisma } from '../../src/lib/prisma/index.ts'

function generateDatabaseUrl(schema: string) {
    const baseUrl = process.env.DATABASE_URL
    if(!baseUrl) {
        throw new Error('Please provide a DATABASE_URL environment variable for the test database.')
    }

    const url = new URL(baseUrl)
    url.searchParams.set('schema', schema)

    return url.toString()
}

export default <Environment> {
    name: 'prisma',
    viteEnvironment: 'ssr',
    async setup() {
        const schema = randomUUID()
        
        const databaseUrl = generateDatabaseUrl(schema)

        process.env.DATABASE_URL = databaseUrl

        console.log(`Database URL for test: ${databaseUrl}`)

        execSync('npx prisma db push', { stdio: 'inherit' })

        return {
            async teardown() {
                await prisma.$executeRawUnsafe(`
                    DROP SCHEMA IF EXISTS "${schema}" CASCADE;   
                `)

                await prisma.$disconnect()
            }
        }
    }
}