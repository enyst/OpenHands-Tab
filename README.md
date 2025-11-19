# OpenHands-Tab

A VS Code extension and TypeScript SDK intended to run in VS Code for building AI agents with OpenHands.

> Scope: VS Code Extension only — this project targets VS Code. The @openhands/agent-sdk-ts package is intended to run inside the OpenHands-Tab extension.

This repository provides two complementary components:
1. **@openhands/agent-sdk-ts** - A TypeScript SDK used by the extension for LLM orchestration, tool execution, and state management (VS Code environment)
2. **OpenHands Tab VS Code Extension** - A native VS Code interface for interacting with OpenHands agents directly in your IDE

The extension connects to an [OpenHands agent-server](https://github.com/All-Hands-AI/agent-sdk) backend and provides a rich, integrated development experience with real-time streaming, file editing, terminal integration, and more.

## Getting Started

### Prerequisites

- Visual Studio Code 1.104.0 or higher
- Node.js 22.x or higher
- Python 3.12+ (optional; only needed when using a remote agent-server)
- Access to an LLM provider (OpenAI, Anthropic, or self-hosted)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/enyst/OpenHands-Tab.git
   cd OpenHands-Tab
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up the agent-sdk backend (see [agent-sdk documentation](https://github.com/OpenHands/software-agent-sdk))

### Development

1. Open the project in VSCode
2. Press `F5` to launch a new Extension Development Host
3. The extension will be available in the new VSCode window

### Monorepo layout & SDK builds

This repository is an npm workspace. The VS Code extension (root package) depends on the shared TypeScript SDK that lives in `packages/agent-sdk-ts` and is published as `@openhands/agent-sdk-ts`.

- `npm run build` runs the SDK build first (`npm run build -w @openhands/agent-sdk-ts`) and then compiles the extension/webview bundles.
- `npm run test` executes `npm test -w @openhands/agent-sdk-ts` before running the extension Vitest suite, ensuring both projects stay green in CI.
- `npm run lint` calls the SDK lint task before linting the extension sources.

You can work on the SDK package in isolation with the usual npm workspace commands:

```bash
# Build ESM/CJS bundles + declaration files
npm run build -w @openhands/agent-sdk-ts

# Run the Vitest suite from packages/agent-sdk-ts
npm test -w @openhands/agent-sdk-ts

# Lint the SDK package with its dedicated ESLint config
npm run lint -w @openhands/agent-sdk-ts
```

> 💡 If you edit `packages/agent-sdk-ts`, rerun `npm run build -w @openhands/agent-sdk-ts` (or `npm run build`) before launching the extension so the bundled `node_modules/@openhands/agent-sdk-ts/dist` reflects your latest changes.

### The @openhands/agent-sdk-ts Package

The SDK provides a TypeScript implementation used by the VS Code extension for building OpenHands agents. It is intended to run inside the VS Code environment and is not supported for standalone use. It includes:

**Conversation Layer** (Primary API):
- `Conversation()` - Factory function that creates local or remote conversation instances
- `LocalConversation` - In-memory agent execution for VS Code with workspace tools
- `RemoteConversation` - WebSocket-based remote agent communication with auto-reconnect
- Event-driven API: `.on('event', ...)`, `.on('status', ...)`, `.on('error', ...)`
- Dual mode support: Automatically selects local or remote based on serverUrl
- Local mode runs directly inside VS Code; remote mode requires an agent-server

**Runtime Layer**:
- `AgentOrchestrator` - LLM orchestration with streaming support
- `EventLog` - Event management and history tracking
- `ConversationState` - Stateful conversation tracking with snapshots
- `SecretRegistry` - Secure credential and secret management
- `AsyncLock` - Concurrency control for agent operations
- `AgentContext` - Skills system for loading and managing agent capabilities from markdown files
- Skills support with trigger types (KeywordTrigger, TaskTrigger) and ~/.openhands/skills/ directory

**LLM Integration**:
- Streaming LLM clients for Anthropic and OpenAI-compatible APIs
- Factory pattern for creating LLM clients with proper configuration
- Token usage tracking and caching support
- Credential management with secure storage

**Tool System**:
- `TerminalTool` - Execute shell commands (cwd, timeoutMs). Returns stdout/stderr/exitCode.
- `FileEditorTool` - Write or append file contents with path validation. Args: { path, content, append? }
- `TaskTrackerTool` - In-memory tasks: actions {create, update, complete, list}; fields: {title, notes, completed}
- `BrowserTool` - HTTP GET/POST with size limits (maxBytes). URL validation (http/https only).
- `BrowserUseTool` - Browser automation suite with 10 tools for navigation, clicking, typing, scrolling, tab management, and content extraction (currently stubbed)
- `DelegateTool` - Multi-agent delegation for spawning and managing sub-agents (currently stubbed)
- `GlobTool` - File pattern matching using picomatch for finding files by glob patterns
- `GrepTool` - Content search with regex support for searching code and text
- `PlanningFileEditorTool` - Planning-specific file editor restricted to PLAN.md
- `IntegratedTerminalRunner` - VS Code terminal-backed command runner used by TerminalTool

**Workspace Abstraction**:
- `LocalWorkspace` - File system operations with path validation

**Protocol Types**:
- Complete TypeScript types for Message/Event protocol
- Type guards for runtime validation
- Support for all event types (MessageEvent, ActionEvent, ObservationEvent, etc.)

**Testing**:
- Unit tests with Vitest and @testing-library/react
- E2E tests with Mocha and @vscode/test-electron
- Coverage thresholds: 60% statements, 50% branches, 60% functions, 60% lines

See [AGENTS.md](AGENTS.md) for contribution guidelines, [packages/agent-sdk-ts/AGENTS.md](packages/agent-sdk-ts/AGENTS.md) for detailed SDK documentation, and [docs/agent-sdk-architecture.md](docs/agent-sdk-architecture.md) for architecture details.

### Backend Prerequisite: OpenHands Agent Server (V1, agent-sdk)

This extension targets the V1 server bundled with All-Hands-AI/agent-sdk. Clone and run the server locally with uv.

Quick start:
```bash
# 1) Clone the V1 SDK (if not already present)
git clone https://github.com/All-Hands-AI/agent-sdk.git
cd agent-sdk

# 2) Setup (requires uv >= 0.8.13)
make build

# 3) Run the agent-server (FastAPI/WS)
uv run agent-server --host 0.0.0.0 --port 3000
```

Notes:
- API base: http://localhost:3000
- WebSocket: ws://localhost:3000/sockets/events/{conversation_id}
- REST endpoints used by this extension:
  - POST /api/conversations/ (start)
  - POST /api/conversations/{id}/events/ (send message)
  - POST /api/conversations/{id}/pause (pause)
  - Optional: /api/conversations/{id}/run, /api/conversations/{id}/secrets
- Auth (optional): set SESSION_API_KEY in the server env; the extension will
  send X-Session-API-Key and add ?session_api_key=... to WS if SESSION_API_KEY is present in the VS Code host env.
- LLM configuration: export LITELLM_API_KEY or OPENAI_API_KEY in the VS Code
  environment; the extension forwards one of these for starting conversations.

### Using the Extension

- In VS Code, ensure the setting `openhands.serverUrl` points to your server (default `http://localhost:3000`).
- Launch the extension (F5), run “OpenHands: Open Tab”, then “OpenHands: Start New Conversation”, and chat.

### Optional: Session API Key

If your agent-server requires a session API key:
- HTTP: `X-Session-API-Key: <key>`
- WebSocket: `?session_api_key=<key>` on the WS URL
- Provide `SESSION_API_KEY` in the VS Code environment to let the extension attach it automatically

### Remote Host Usage (this environment)

- We also run agent-server bound to 0.0.0.0 on the exposed host:
  - https://<your-dev-host-1>
  - Optional second instance: https://<your-dev-host-2>
- Set `openhands.serverUrl` to one of the above, e.g.:
  - https://<your-dev-host-1>
- The WebSocket endpoint and HTTP endpoints remain the same relative to the base URL (see [docs/PRD.md](docs/PRD.md) section 5).

### Run with Session API Key (optional)

If your agent-server requires a session API key:

1) Provide `SESSION_API_KEY` to the VS Code Extension Host environment. Examples:
- macOS/Linux (launching dev host):
  - `SESSION_API_KEY=sk_xxx code .`
- VS Code launch.json (add env):
  ```json
  {
    "name": "Run Extension",
    "type": "extensionHost",
    "request": "launch",
    "runtimeExecutable": "${execPath}",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
    "outFiles": ["${workspaceFolder}/dist/**/*.js"],
    "preLaunchTask": "npm: compile",
    "env": { "SESSION_API_KEY": "sk_xxx" }
  }
  ```

2) The extension will automatically:
- Add `X-Session-API-Key: <key>` to HTTP requests
- Append `?session_api_key=<key>` to the WebSocket URL

## Documentation

Detailed documentation is available in the [docs/](docs/) directory:

- **[AGENTS.md](AGENTS.md)** - Contribution guidelines for AI agents
- **[agent-sdk-architecture.md](docs/agent-sdk-architecture.md)** - SDK architecture documentation
- **[e2e_testing.md](docs/e2e_testing.md)** - End-to-end testing guide
- **[IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** - Implementation phases and progress
- **[LINTING.md](docs/LINTING.md)** - Linting guidelines and configuration
- **[packages/agent-sdk-ts/AGENTS.md](packages/agent-sdk-ts/AGENTS.md)** - SDK-specific development guidelines and architecture
- **[packages/agent-sdk-ts/docs/python-parity.md](packages/agent-sdk-ts/docs/python-parity.md)** - Python SDK alignment documentation
- **[PRD.md](docs/PRD.md)** - Product requirements and architecture overview
- **[settings_prd.md](docs/settings_prd.md)** - Settings system architecture and LLM configuration
- **[vscode_local_setup.md](docs/vscode_local_setup.md)** - Local VS Code setup for development
- **[vscode_remote_setup.md](docs/vscode_remote_setup.md)** - Headless VS Code setup for AI agents
- **Bash Events** - Live terminal integration is now handled by `LocalConversation` in local mode.
