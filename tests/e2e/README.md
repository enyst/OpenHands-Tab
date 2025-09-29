# E2E Tests

This folder contains minimal E2E scaffolding using @vscode/test-electron.

- openTab.test.ts: orchestrates a VS Code instance and runs the suite entry.
- suite/index.ts: called by the VS Code runner; triggers extension commands.

Run locally:
- npm run e2e

Notes:
- These are smoke tests. They don’t yet verify webview DOM. For deeper checks, expose a diagnostics command in the extension or use a headless desktop with UI automation.
