# Contributing

Thanks for building on OpenHands Tab! The repo now uses npm workspaces so the SDK package and the VS Code extension can share the same source tree.

## Workspace layout

- `./` – VS Code extension, build scripts, docs, and integration tests.
- `packages/agent-sdk-ts` – TypeScript definitions + type guards for the OpenHands agent-server protocol, published as `@openhands/agent-sdk-ts`. This package produces both CJS and ESM bundles via `tsup` and emits `.d.ts` files via `tsc`.

## Common tasks

All commands can be run from the repo root:

```bash
# Install dependencies for every workspace
npm install

# Build SDK (tsup + tsc) and then compile the extension/webview
npm run build

# Execute SDK Vitest specs and then the extension Vitest suite
npm test

# Run both lint configs (SDK first, then extension)
npm run lint
```

To focus on the SDK package you can use workspace-qualified commands:

```bash
npm run build -w @openhands/agent-sdk-ts
npm test -w @openhands/agent-sdk-ts
npm run lint -w @openhands/agent-sdk-ts
```

Running `npm run package` or `vsce package` automatically triggers `npm run build`, so the SDK artifacts are always up to date when bundling the extension.
