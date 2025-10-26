// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'dist/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      '*.gen.*',
      'src/webview-src/tailwind.gen.css',
      'tests/e2e/out/**',
      'esbuild.*.mjs',
    ],
  },
  {
    // Production code: enable type-aware linting
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: ['./tsconfig.json', './tsconfig.webview.json'],
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      // Prevent unused variables and parameters (this would catch the idx issue!)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Code quality rules
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Best practices
      'no-console': 'off', // VS Code extensions use console
      'no-undef': 'off', // TypeScript handles this better; avoids false positives with TS globals (NodeJS, etc.)
      'no-empty': ['error', { allowEmptyCatch: true }], // Allow empty catch blocks (common for error swallowing)
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',

      // React-specific (for webview code)
      '@typescript-eslint/no-empty-function': 'warn',
    },
  },
  {
    // Test files: non-type-aware linting (tests excluded from tsconfig)
    files: ['**/__tests__/**/*.ts', '**/__tests__/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // No 'project' option - tests are excluded from tsconfig files
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.mocha, // E2E tests use Mocha (describe, it, before, after, etc.)
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,

      // Same core rules but relaxed for tests
      '@typescript-eslint/no-unused-vars': 'off', // Many test fixtures have intentionally unused vars
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off', // Allow generic Function type in test helpers
      'no-empty': 'off',
    },
  },
];
