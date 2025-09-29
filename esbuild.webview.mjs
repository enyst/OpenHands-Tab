import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/webview-src/webview.tsx'],
  outfile: 'media/webview.js',
  bundle: true,
  sourcemap: true,
  format: 'esm',
  loader: { '.css': 'css', '.png': 'file' },
});
