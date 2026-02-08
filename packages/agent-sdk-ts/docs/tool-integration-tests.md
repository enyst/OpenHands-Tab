# Tool Integration Tests

This guide documents the lightweight integration test suite for agent-sdk tools. These tests execute real tools (not event injection) and assert the output payloads (`stdout`, `stderr`, `exit_code`, etc.) that are sent to the LLM.

## Where the tests live

- `packages/agent-sdk-ts/src/tools/__tests__/integration/`
- Each test uses a temporary `LocalWorkspace` and cleans up after itself.

## How to run

Run only the integration tests:

```bash
npm test -w @smolpaws/agent-sdk -- --run src/tools/__tests__/integration
```

Or run a specific test file:

```bash
npm test -w @smolpaws/agent-sdk -- --run src/tools/__tests__/integration/terminal.integration.test.ts
```

## CI behavior

The integration tests are regular Vitest tests inside `@smolpaws/agent-sdk`, so they run automatically in CI as part of:

```bash
npm test -w @smolpaws/agent-sdk
```

## Environment requirements

- A local shell environment is required (TerminalTool uses `/bin/bash` on non-Windows hosts).
- Node.js must be available on PATH for the sample commands.
- The integration tests currently skip on Windows to avoid shell differences.

## Scope notes

- Start with `TerminalTool` output payloads (stdout/stderr/exit_code).
- Additional tools (FileEditor, Browser, etc.) can be added in follow-up tests using the same harness.
