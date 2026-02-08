# OpenHands-Tab Prototype

<img width="607" height="450" alt="image" src="https://github.com/user-attachments/assets/32e27cd3-452a-4a90-bf57-45a1b4f76ec8" />
<img width="602" height="304" alt="image" src="https://github.com/user-attachments/assets/eb658ee6-6e0e-4a9c-85bb-e77e1339d607" />
<img width="423" height="253" alt="image" src="https://github.com/user-attachments/assets/596e5d1e-ebfd-4595-a2b7-3a673f5436a8" />


A VS Code extension for interacting with OpenHands AI agents directly in your IDE.

## Features

- UX first: switching LLM at runtime
- Streaming event display and most other OpenHands features
- Local mode (runs agent in VS Code) or remote mode (connects to agent-server)
- Might also have a lil' cheesy Easter Egg (because why not?)

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
  - Run [OpenHands-CLI](https://github.com/OpenHands/OpenHands-CLI), or another agent of your choice, including itself
  - Tell it to clone, build, install, or ask it questions about this repo if you'd like. It can tell stories.

### Development (recommended)

1. Run [OpenHands-CLI](https://github.com/OpenHands/OpenHands-CLI) in the extension directory
2. Tell it to build, install, and run VSCode in dev/debug on `cwd`
3. Have fun!

### Development (old style)

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. Click the OpenHands icon in the Activity Bar to reveal the chat sidebar view

### Configuration

- You can use LLM Profiles View or regular VS Code Settings to set LLM Providers API key(s)
- Set Gemini API key (used for summarizations, highly **recommended**)
- Set GitHub token
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
| [docs/agent-sdk-architecture.md](docs/agent-sdk-architecture.md) | SDK architecture details |
| [docs/vscode_local_setup.md](docs/vscode_local_setup.md) | Local development setup |
| [docs/vscode_remote_setup.md](docs/vscode_remote_setup.md) | Headless/remote setup |

## Architecture

This is an npm workspace with two packages:

1. **Root package** - VS Code extension (`src/`)
2. **@smolpaws/agent-sdk** - TypeScript SDK (`packages/agent-sdk-ts/`)

The SDK provides the `Conversation` API, LLM clients, tools, and protocol types.

## Commands

```bash
npm run build           # Build SDK + extension + webview
npm run compile         # Compile TypeScript + Tailwind + webview (faster)
npm test                # Run all tests
npm run lint            # Lint all code
npm run package         # Package extension as VSIX
```

## License

MIT
