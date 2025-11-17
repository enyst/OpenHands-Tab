# Agent SDK (TypeScript)

## Purpose & Layout
- `src/` holds the runtime SDK models, zod guards, and helpers that the VS Code extension reuses.
- `dist/` is generated output from `tsup` and TypeScript; never edit files there by hand.
- `tsup.config.ts`, `tsconfig.json`, and `vitest.config.ts` configure bundling, declaration emit, and tests for this package.

## Development Commands
- Install dependencies from the repository root with `npm install`; it wires workspaces automatically.
- `npm run build -w @openhands/agent-sdk-ts` emits CJS/ESM bundles plus `.d.ts` files.
- `npm test -w @openhands/agent-sdk-ts` runs the Vitest suite. Use `vitest --watch` from this folder for faster iteration.
- `npm run lint -w @openhands/agent-sdk-ts` enforces the standalone ESLint config; fix autofixable issues with `npm run lint -w @openhands/agent-sdk-ts -- --fix`.

## Coding Guidelines
- Match the repository defaults: TypeScript (ES2022), 2-space indentation, single quotes, and trailing semicolons.
- Keep runtime-facing types colocated with their guards to guarantee parity between compilation and runtime validation.
- The SDK primarily serves the OpenHands VS Code extension, so it is fine to depend on VS Code types or semantics when doing so makes integration simpler.

## Testing Notes
- Prefer deterministic fixtures for protocol payloads; add shared mocks under `test/__mocks__` in the root if they are broadly useful.
- When changing schemas, cover both happy-path parsing and failure states to prevent silent contract drift.

## Release Considerations
- Bump the package version in `package.json` when publishing to npm and run `npm run build -w @openhands/agent-sdk-ts` beforehand.
- After changes land, rebuild the VS Code extension (`npm run build`) to ensure the workspace dependency picks up the updated SDK bundle.
