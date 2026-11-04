import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.dependency-cruiser.cjs', 'dist/**', 'dev-dist/**', 'tools/**', 'public/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use core/rng keyed streams (determinism).' },
        { object: 'Date', property: 'now', message: 'Engine code must not read wall-clock time.' }],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/workers/**/*.ts', 'src/persistence/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
);
