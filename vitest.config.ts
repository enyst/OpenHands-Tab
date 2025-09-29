import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Exclude E2E (mocha/@vscode/test-electron) from unit tests
    exclude: [
      'media/**',
      'dist/**',
      'out/**',
      '.vscode-test/**',
      'node_modules/**',
      'tests/e2e/**',
    ],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
