import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/webview-src/webview.tsx', 'src/webview-src/webview.css'],
  outdir: 'media',
  bundle: true,
  sourcemap: true,
  format: 'esm',
  loader: { '.css': 'css', '.png': 'file' },
});
