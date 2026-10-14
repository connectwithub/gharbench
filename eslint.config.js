import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'runs/**',
      'private-pool/**',
      // Gitignored calibration store (cases, labels, verdicts, one-off analysis
      // scripts): data and scratch, never part of the harness build.
      'calibration/**',
      'human-validation/**',
      // Private-tracked sync folder (claude.ai project mirror + its render script).
      'docs/claude-project/**',
      'stats-bridge/.venv/**',
      'dist/**',
      // Vendored verbatim under someone else's licence. Never lint or reformat.
      'docs/tau2-attribution/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Plain-JS maintenance scripts. The TS config turns `no-undef` off because
    // the compiler already catches it; .mjs files get no such backstop, so the
    // Node globals have to be declared.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
);
