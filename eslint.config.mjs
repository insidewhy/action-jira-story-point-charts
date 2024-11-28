import { includeIgnoreFile } from '@eslint/compat'
import eslint from '@eslint/js'
import configPrettier from 'eslint-config-prettier'
import pluginImport from 'eslint-plugin-import'
import globals from 'globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as typescriptEslint from 'typescript-eslint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const gitignorePath = path.resolve(__dirname, '.gitignore')

export default [
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  configPrettier,
  pluginImport.flatConfigs.recommended,
  includeIgnoreFile(gitignorePath),
  { ignores: ['lib'] },
  {
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
      'import/resolver': {
        typescript: {},
      },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'import/order': [
        'error',
        {
          named: {
            enabled: true,
            types: 'types-first',
          },
          'newlines-between': 'always',
          groups: [
            ['builtin', 'external'],
            ['internal', 'parent', 'sibling', 'index', 'object'],
          ],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
              position: 'before',
            },
          ],
          distinctGroup: false,
          alphabetize: {
            caseInsensitive: true,
            order: 'asc',
          },
        },
      ],
      // typescript already checks these and they slow down eslint, see
      // https://github.com/import-js/eslint-plugin-import/issues/2346#issuecomment-1623809759
      'import/default': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/no-unresolved': 'off',
    },
  },
]
