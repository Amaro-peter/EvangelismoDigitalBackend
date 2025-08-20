import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'

export default [
  {
    ignores: ['dist', 'node_modules', 'coverage', 'logs', 'src/generated'],
  },
  {
    files: ['src/**/*.{js,mjs,cjs,ts}', 'spec/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/no-extraneous-class': 'off',
      semi: ['error', 'never'],
    },
  },
]
