# Agent-Server Quickstart for E2E

Goal: run an agent-server compatible with this extension’s POST /api/conversations and WS /sockets/events endpoints.

Option A: agent-sdk local (recommended for developers)
- Prereqs: Python 3.12+, [uv](https://github.com/astral-sh/uv)
- Steps:
  1) `git clone https://github.com/OpenHands/software-agent-sdk.git ~/repos/agent-sdk`
  2) `cd ~/repos/agent-sdk && make build` (optional; `uv run` will usually work without it)
  3) Start server from this repo:
     - `AGENT_SDK_DIR=~/repos/agent-sdk PORT=3000 ./scripts/start-agent-server.sh`
     - Or manually (from `~/repos/agent-sdk`): `uv run python -m openhands.agent_server --host 127.0.0.1 --port 3000`
  4) In VS Code (Extension Dev Host), set openhands.serverUrl to <http://localhost:3000>

Option B: remote server
- If you have a remote agent-server URL, set openhands.serverUrl accordingly.
- If it requires a session API key, set it via `OpenHands: Set Session API Key`.

Session API Key (optional)
- HTTP: the extension adds `X-Session-API-Key` when `openhands.secrets.sessionApiKey` is set
- WebSocket: the extension appends `?session_api_key=...` to the WS URL when `openhands.secrets.sessionApiKey` is set

Notes
- The extension sends a Start Conversation payload containing LLM and tool configuration for PoC. Ensure your server accepts that.
- Live agent-server E2E tests are gated behind `E2E_AGENT_SERVER=1` and will skip otherwise.
