import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/webview-src/webview.tsx', 'src/webview-src/index.css'],
  outdir: 'media',
  bundle: true,
  sourcemap: true,
  format: 'esm',
  loader: { '.css': 'css', '.png': 'file' },
});
