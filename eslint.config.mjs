import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // apps/desktop/resources/templates: Starter-Vorlagen sind Browser-Code,
    // der in Nutzer-Workspaces kopiert wird — kein Repo-Quellcode.
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', 'apps/desktop/resources/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-ESM-Skripte (z. B. apps/desktop/scripts/rebuild-native.mjs) laufen
    // unter Node — process/console sind dort echte Globals.
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
