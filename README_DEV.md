Development notes
- Run `npm install`
- Build: `npm run compile` (compiles TypeScript, builds Tailwind CSS, and bundles webview)
- Launch: use VSCode F5 (Run Extension)

Webview stack:
- React (single webview root) with @openhands/ui components
- Tailwind CSS 4.x (compiled from src/webview-src/tailwind.css to src/webview-src/tailwind.gen.css)
- Unified CSS bundled to media/index.css (no unsafe-inline CSP)
- Webview bundle: src/webview-src/webview.tsx → media/webview.js via esbuild
- Default server URL: http://localhost:3000
- Works with agent-server >= 1.1.0 (new REST schema, tool ids `terminal`/`file_editor`/`task_tracker`, `/api/conversations/{id}/run` resume)
