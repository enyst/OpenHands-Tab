import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: true,
  external: [
    'vscode',
    // Optional native perf deps used by ws; keep external to avoid resolution/bundling
    'utf-8-validate',
    'bufferutil',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
