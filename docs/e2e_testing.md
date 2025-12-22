# End-to-End (E2E) Testing Guide

This document explains how to run automated E2E tests for the OpenHands-Tab VS Code extension. These tests verify the full loop: extension UI (webview) ↔ extension host ↔ agent-server.

**Note:** For remote/headless VS Code setup with noVNC (used by AI agents), see [vscode_remote_setup.md](./vscode_remote_setup.md).

## Scope

- Smoke tests: extension activates, commands are registered, webview opens and renders
- Interaction: send a user message and observe streamed events from an agent-server
- Environment options: local desktop or automated CI testing

## Prerequisites

- Node.js 22+
- VS Code Desktop (Electron build)
- Optional: Python 3.12+ and agent-server (agent-sdk) running for full integration testing
- Recommended default server URL: <http://localhost:3000>

## Testing Approaches

### Option A: Local Manual E2E (Fastest Validation)
1) Install and build the extension
   - npm install
   - npm run compile
2) Start agent-server (separate terminal)
   - Recommended: use a local checkout of [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk)
     - First time: `AGENT_SDK_DIR=~/repos/agent-sdk npm run agent-server:prepare`
     - After: `AGENT_SDK_DIR=~/repos/agent-sdk npm run agent-server`
   - Or clone it:
     - `git clone https://github.com/OpenHands/software-agent-sdk.git ~/repos/agent-sdk`
     - `cd ~/repos/agent-sdk && make build`
     - `uv run python -m openhands.agent_server --host 0.0.0.0 --port 3000`
3) Launch the extension in VS Code
   - Open this folder in VS Code
   - Press F5 to run “Extension Development Host”
4) In the Dev Host window
   - Run “OpenHands: Configure” → ensure server URL is <http://localhost:3000>
   - Run “OpenHands: Open” (reveals the chat sidebar view)
   - Run "OpenHands: Start New Conversation"
   - Type a message and verify assistant/tool events stream in the webview

### Option B: Automated E2E Tests with @vscode/test-electron

Automated E2E scaffolding has been added under `tests/e2e/`. Run with `npm run e2e`.

This approach programmatically launches VS Code with the extension under test and runs Mocha tests. It is suitable for CI and provides repeatable, automated verification. Webview DOM assertions are possible but require bridging or using VS Code APIs to read webview HTML.

#### Running E2E Tests

```bash
# Run all E2E tests
npm run e2e

# This will:
# 1. Compile TypeScript
# 2. Download VS Code test instance (cached)
# 3. Launch VS Code with extension
# 4. Run test suite in tests/e2e/
```

The test infrastructure includes:
- `tests/e2e/` - Test files and suite configuration
- `@vscode/test-electron` - VS Code test runner
- Mocha test framework
- TypeScript compilation via `ts-node`

#### Test Structure

Example test structure (see `tests/e2e/` for actual tests):

```typescript
import { runTests } from '@vscode/test-electron';

describe('OpenHands-Tab E2E', function() {
  this.timeout(120000);

  it('opens the chat webview and renders HTML', async () => {
    // VS Code launches with extension loaded
    // Test suite verifies commands, webview, etc.
  });
});
```

## Notes and Gotchas

**Webview Testing:**
- Direct DOM access from the test process isn't available
- Consider asserting webview HTML contains known markers (e.g., `<title>OpenHands Tab</title>`)
- Can instrument the extension to expose a diagnostics API during tests
- Use the `openhands._diagnostics` command for test visibility

**Agent-Server Dependency:**
- For fully integrated tests (send message and read streamed events), ensure the server is reachable
- In CI, you can launch a local agent-server or point to a remote test instance
- By default, the agent-server E2E test runs with auth disabled (`SESSION_API_KEY=''`)
- To run an authenticated agent-server E2E, set `SESSION_API_KEY` in your environment (the test runner forwards it to both the spawned server and the VS Code extension host)

**Test Stability:**
- Start with smoke tests (activation + command execution + webview created)
- Add network-dependent assertions once the server contract is stable
- Use timeouts appropriately for async operations

## Minimal Smoke Test Acceptance

Whether testing manually or automated, verify:
- ✅ VS Code launches with the extension
- ✅ Command "OpenHands: Open" succeeds and the chat view appears
- ✅ Command "OpenHands: Start New Conversation" succeeds (HTTP 201)
- ✅ WebSocket connects (status shows online) and events stream when you send a message

## CI Integration

GitHub Actions workflows can be added in `.github/workflows/`:

**Suggested workflows:**
- `e2e.yml`: Runs E2E tests on PRs/pushes (ubuntu-latest, Node 22, Xvfb)
- `unit-tests.yml`: Runs Vitest unit tests
- `build-vsix.yml`: Full build + test + package extension

**Example E2E CI job:**
```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: xvfb-run -a npm run e2e
```

## Related Documentation

- [vscode_remote_setup.md](./vscode_remote_setup.md) - Headless VS Code setup for AI agents
- [README.md](../README.md) - General extension documentation
- [PRD.md](./PRD.md) - Product requirements and architecture

## References

- [VS Code Extension Testing](https://github.com/microsoft/vscode-test)
- [@vscode/test-electron](https://github.com/microsoft/vscode-test/tree/main/sample)
- [Mocha Test Framework](https://mochajs.org/)
