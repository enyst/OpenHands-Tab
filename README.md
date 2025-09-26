# OpenHands-Tab Prototype

A VS Code extension that brings the power of OpenHands AI agents directly into your development environment. This extension provides an alternative way to interact with the [OpenHands agent-sdk](https://github.com/All-Hands-AI/agent-sdk), without leaving your IDE.

## Getting Started

### Prerequisites

- Visual Studio Code 1.85.0 or higher
- Node.js 22.x or higher
- Python 3.12+ (for agent-sdk backend)
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

3. Set up the agent-sdk backend (see [agent-sdk documentation](https://github.com/All-Hands-AI/agent-sdk))

### Development

1. Open the project in VSCode
2. Press `F5` to launch a new Extension Development Host
3. The extension will be available in the new VSCode window

### Local Run (agent-server + extension)

- Start the agent-server (agent-sdk) locally on port 3000 using uv:
  ```bash
  cd agent-sdk
  uv run python -m openhands.agent_server --host 0.0.0.0 --port 3000
  ```

- In VS Code, set the extension setting `openhands.serverUrl` to `http://localhost:3000` (default).

- Optional session API key (not needed for local testing unless configured):
  - HTTP: send header `X-Session-API-Key: <key>`
  - WebSocket: append `?session_api_key=<key>` to the WS URL

- Launch the extension (F5), run “OpenHands: Open Tab”, then “OpenHands: Start New Conversation”, and chat.

### Remote Host Usage (this environment)

- We also run agent-server bound to 0.0.0.0 on the exposed host:
  - https://<your-dev-host-1>
  - Optional second instance: https://<your-dev-host-2>
- Set `openhands.serverUrl` to one of the above, e.g.:
  - https://<your-dev-host-1>
- The WebSocket endpoint and HTTP endpoints remain the same relative to the base URL (see PRD section 5).

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
