import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // apps/desktop/resources/templates: starter templates are browser code
    // copied into user workspaces — not repo source code.
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', 'apps/desktop/resources/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node ESM scripts (e.g. apps/desktop/scripts/rebuild-native.mjs) run
    // under Node — process/console are real globals there.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
