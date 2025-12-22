# OpenHands-Tab Prototype

<img width="1278" height="830" alt="image" src="https://github.com/user-attachments/assets/2f259567-d906-44ba-8f08-eef92585890d" />

A VS Code extension for interacting with OpenHands AI agents directly in your IDE.

## Features

- Chat interface with streaming event display
- Local mode (runs agent in VS Code) or remote mode (connects to agent-server)
- Action confirmation with security risk indicators
- Conversation history and persistence
- Workspace file context and skills support
- Integrated terminal output

## Quick Start

### Prerequisites

- VS Code 1.104.0+
- Node.js 22+

### Installation

```bash
git clone https://github.com/enyst/OpenHands-Tab.git
cd OpenHands-Tab
npm install
npm run build
```

### Development

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. Click the OpenHands icon in the Activity Bar (or run "OpenHands: Open") to reveal the chat sidebar view

### Git Hooks (optional)

This repo uses Husky + lint-staged to run ESLint on staged `*.ts`/`*.tsx` files before commit (installed automatically by `npm install` via the `prepare` script).

- Bypass hooks: `git commit --no-verify`
- Run manually: `npm exec -- lint-staged`

### Configuration

- **OpenHands: Configure** - Set up server URL, LLM settings, API keys
- **OpenHands: Set API Key** - Quick LLM API key configuration
- **OpenHands: Set Session API Key** - Set session API key for agent-server authentication
- **OpenHands: Set GitHub Token** - Set GitHub token for repository access
- **OpenHands: Set Custom Secret 1/2/3** - Set custom secrets for additional integrations
- Leave server URL blank for local mode, or set it to connect to an [agent-server](https://github.com/OpenHands/software-agent-sdk)

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](AGENTS.md) | Quick reference for AI agents |
| [docs/PRD.md](docs/PRD.md) | Product requirements and architecture |
| [docs/agent-sdk-architecture.md](docs/agent-sdk-architecture.md) | SDK architecture details |
| [docs/vscode_local_setup.md](docs/vscode_local_setup.md) | Local development setup |
| [docs/vscode_remote_setup.md](docs/vscode_remote_setup.md) | Headless/remote setup |
| [packages/agent-sdk-ts/AGENTS.md](packages/agent-sdk-ts/AGENTS.md) | SDK development guide |

## Architecture

This is an npm workspace with two packages:

1. **Root package** - VS Code extension (`src/`)
2. **@openhands/agent-sdk-ts** - TypeScript SDK (`packages/agent-sdk-ts/`)

The SDK provides:
- `Conversation` API for local/remote agent execution
- LLM clients (Anthropic, OpenAI-compatible)
- Tools (Terminal, FileEditor, TaskTracker, Browser, Glob, Grep, BrowserUse, PlanningFileEditor, Delegate)
- Protocol types and event handling

## Commands

```bash
npm run build           # Build SDK + extension + webview
npm run compile         # Compile TypeScript + Tailwind + webview (faster)
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run lint            # Lint all code
npm run lint:fix        # Auto-fix lint issues
npm run typecheck       # Type check all code
npm run watch           # Development watch mode
npm run e2e             # E2E tests
npm run e2e:agent-server  # E2E tests against remote agent-server
npm run package         # Package extension as VSIX
```

## License

MIT
