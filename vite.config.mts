import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig(({ mode }) => {
  // Carrega as variáveis de ambiente baseadas no modo (ex: 'test')
  // O terceiro parâmetro '' diz para carregar TODAS as variáveis, não só as que começam com VITE_
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [tsconfigPaths()],
    test: {
      globals: true,
      dir: 'src',
      environment: 'node',
      // Injeta as variáveis carregadas no ambiente do teste
      env: env,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            dir: 'src/use-cases',
          },
        },
        {
          extends: true,
          test: {
            name: 'e2e',
            dir: 'src/http/controllers',
            environment: './prisma/vitest-environment-prisma/prisma-test-environment.ts',
          },
        },
        {
          extends: true,
          test: {
            name: 'users',
            dir: 'src/http/controllers/users',
            environment: './prisma/vitest-environment-prisma/prisma-test-environment.ts',
          },
        },
      ],
    },
  }
})
