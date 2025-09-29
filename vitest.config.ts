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
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/extension.ts',
        'src/webview-src/webview.ts',
        'src/webview-src/webview.tsx',
      ],
      thresholds: { statements: 60, branches: 50, functions: 60, lines: 60 },
    },
  },
});
