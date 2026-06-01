import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'node_modules/**', 'media/libs/**', '*.vsix']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'models/**/*.ts', 'storage/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
);
