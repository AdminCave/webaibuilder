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
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
