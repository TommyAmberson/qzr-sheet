import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['apps/scoresheet/src/**/*.{ts,vue}'],
    ignores: ['apps/scoresheet/src/**/__tests__/**'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: './apps/scoresheet/tsconfig.app.json',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['apps/scoresheet/src/**/__tests__/**/*.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: './apps/scoresheet/tsconfig.vitest.json',
      },
    },
    rules: {
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: './apps/web/tsconfig.app.json',
        extraFileExtensions: ['.vue'],
      },
      globals: {
        __SCORESHEET_URL__: 'readonly',
      },
    },
    rules: {
      'prefer-const': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/component-api-style': ['error', ['script-setup']],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'apps/scoresheet/src-tauri/**', 'scripts/**'],
  },
  prettier,
)
