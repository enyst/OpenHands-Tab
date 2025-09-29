import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    exclude: ['media/**', 'dist/**', 'out/**', '.vscode-test/**', 'node_modules/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
