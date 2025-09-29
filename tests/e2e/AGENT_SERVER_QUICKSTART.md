# Agent-Server Quickstart for E2E

Goal: run an agent-server compatible with this extension’s POST /api/conversations and WS /sockets/events endpoints.

Option A: agent-sdk local (recommended for developers)
- Prereqs: Python 3.12+, uv (https://github.com/astral-sh/uv)
- Steps:
  1) git clone https://github.com/All-Hands-AI/agent-sdk
  2) cd agent-sdk
  3) uv run python -m openhands.agent_server --host 0.0.0.0 --port 3000
  4) In VS Code (Extension Dev Host), set openhands.serverUrl to http://localhost:3000

Option B: remote server
- If you have a remote agent-server URL, set openhands.serverUrl accordingly.
- If it requires a session API key, set SESSION_API_KEY in the VS Code launch env or shell.

Session API Key (optional)
- HTTP: the extension adds X-Session-API-Key when SESSION_API_KEY is present
- WebSocket: the extension appends ?session_api_key=... to the WS URL

Notes
- The extension sends a Start Conversation payload containing LLM and tool configuration for PoC. Ensure your server accepts that.
- For CI smoke in this repo, we do NOT start a server; tests run with E2E_WITH_SERVER=0.
