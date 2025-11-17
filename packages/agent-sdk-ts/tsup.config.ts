import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  treeshake: true,
  minify: false,
  outExtension({ format }) {
    if (format === 'cjs') {
      return { js: '.cjs' };
    }
    return { js: '.mjs' };
  },
});
