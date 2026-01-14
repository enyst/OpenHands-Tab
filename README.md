# OpenHands-Tab Prototype

<img width="607" height="450" alt="image" src="https://github.com/user-attachments/assets/32e27cd3-452a-4a90-bf57-45a1b4f76ec8" />
<img width="602" height="304" alt="image" src="https://github.com/user-attachments/assets/eb658ee6-6e0e-4a9c-85bb-e77e1339d607" />

A VS Code extension for interacting with OpenHands AI agents directly in your IDE.

## Features

- UX first: switching LLM at runtime
- Streaming event display and most other OpenHands features
- Local mode (runs agent in VS Code) or remote mode (connects to agent-server)
- Might also have a lil' cheesy Easter Egg (because why not?)

## Quick Start

### Prerequisites

- VS Code 1.104.0+
- Node.js >= 22

### Installation for AI agents:
```bash
git clone https://github.com/enyst/OpenHands-Tab.git
cd OpenHands-Tab
npm install
npm run build
```

### Installation for humans:

Open VSCode `Extensions` tab > `Install from .vsix` > point to the downloaded .vsix

Alternatively, for humans in development mode:
  - Run OpenHands-CLI, or another agent of your choice, including itself
  - Tell it to clone, build, install, or to tell you a story about this repo if you'd like

### Development (recommended)

1. Run OpenHands-CLI in the extension directory
2. Tell it to build, install, and run VSCode in dev/debug on `cwd`
3. Have fun!

### Development (old style)

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. Click the OpenHands icon in the Activity Bar (or run "OpenHands: Open") to reveal the chat sidebar view

### Git Hooks

This repo uses Husky + lint-staged to run ESLint on staged `*.ts`/`*.tsx` files before commit (installed automatically by `npm install` via the `prepare` script).

- Run manually: `npm exec -- lint-staged`

### Useful commands

- **OpenHands: Explain Selection** - Explain selected code in the editor (context menu)
- (maybe, outdated) **OpenHands: Configure** - Set up server URL, API keys

### Configuration

- **OpenHands: Set OpenAI API Key** - Set OpenAI API key
- **OpenHands: Set Anthropic API Key** - Set Anthropic API key
- **OpenHands: Set OpenRouter API Key** - Set OpenRouter API key
- **OpenHands: Set LiteLLM Proxy API Key** - Set LiteLLM Proxy API key
- **OpenHands: Set Gemini API Key** - Set Gemini API key (used for summarization, highly **recommended**)
- **OpenHands: Set ElevenLabs API Key** - Set ElevenLabs API key
- **OpenHands: Set Session API Key** - Set session API key for agent-server authentication
- **OpenHands: Set GitHub Token** - Set GitHub token for repository access
- Leave server URL blank for local mode, or set it to connect to an [agent-server](https://github.com/OpenHands/software-agent-sdk)

**Using Gemini**: Gemini can be used in three ways:
- **As the main agent LLM**: set `openhands.llm.profileId` to a Gemini profile id (e.g., `gemini-flash`) and configure your API key via **OpenHands: Set Gemini API Key**
- **As utility for summarization**: highly recommended, just set the key and it will be used for the built-in Gemini profiles
- **For HAL voice confirmation** (optional): HAL uses its own Gemini profile specified by `openhands.hal.llmProfileId` (default: `gemini-flash-hal`) for audio understanding in voice_confirm mode

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](AGENTS.md) | Quick reference for AI agents |
| [docs/PRD.md](docs/PRD.md) | Product requirements and architecture |
| [docs/settings_prd.md](docs/settings_prd.md) | Product requirements and architecture |
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
- LLM clients (Anthropic, OpenAI-compatible, Gemini)
- Tools (Terminal, FileEditor, TaskTracker, Browser, Glob, Grep, BrowserUse, PlanningFileEditor, Delegate, Finish)
- `Workspace` factory for connecting to remote servers
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
