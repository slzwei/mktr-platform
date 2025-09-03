import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import unusedImports from 'eslint-plugin-unused-imports'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: '18.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
      // High-noise rules relaxed for this codebase
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      // Use plugin to auto-remove unused imports/vars; disable core rule to avoid duplication
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Node environment for config and scripts
  {
    files: [
      'vite.config.js',
      'tailwind.config.js',
      '**/*.config.js',
      'test-login.js',
      'backend/**/*.{js,jsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      // Config files often use Node globals like __dirname/require/module
      'no-undef': 'off',
    },
  },
  // Jest globals for backend tests
  {
    files: ['backend/**/*.test.js', 'backend/test/**/*.js', 'backend/src/tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
  // UI primitives often use custom attributes from third-party libs
  {
    files: ['src/components/ui/**/*.{js,jsx}'],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
]
