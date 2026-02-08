# Agent-Server (Python) Prep + Test Matrix (oh-tab-4wg)

This document captures the minimal setup and a test matrix for running the OpenHands-Tab VS Code extension against the **Python agent-server** on localhost.

## Goal

- Provide repeatable, human-friendly steps for running the Python agent-server locally.
- Define a test matrix (local vs remote mode, server selection, connection/error states) that will drive:
  - new E2E coverage (`oh-tab-o6t`)
  - CI automation (`oh-tab-2zr`, `oh-tab-d0b`)

## References

- TS RemoteConversation endpoints: `packages/agent-sdk/src/sdk/conversation/RemoteConversation.ts`
  - HTTP: `POST {serverUrl}/api/conversations`
  - WS: `ws(s)://{serverUrl}/sockets/events/{conversationId}?resend_all=true`
    - Auth: WS handshake headers for non-browser clients (`X-Session-API-Key` / `Authorization: Bearer ...`).
    - Legacy (browser-only): `?session_api_key=...` query param.
    - Note: the “no URL secrets” WS contract lands once upstream `OpenHands/software-agent-sdk#1786` is deployed and downstream `enyst/OpenHands-Tab#873` is merged.
- Python agent-sdk examples:
  - `~/repos/agent-sdk/examples/02_remote_agent_server/01_convo_with_local_agent_server.py`
  - Server command used there: `python -m openhands.agent_server --host 127.0.0.1 --port 8001`

## Local server startup (manual)

Assumptions:
- You have the Python agent-sdk repo checked out at `~/repos/agent-sdk`.
- You have a working Python environment for that repo (see `~/repos/agent-sdk/DEVELOPMENT.md`).

Start the server:
```bash
cd ~/repos/agent-sdk
python -m openhands.agent_server --host 127.0.0.1 --port 8001
```

Confirm health (server prints logs; endpoint may vary by implementation):
```bash
curl -fsS http://127.0.0.1:8001/health
```

## VS Code extension setup (manual)

1. Launch the extension in dev mode:
   ```bash
   cd /path/to/oh-tab
   code "$(pwd)" --extensionDevelopmentPath="$(pwd)"
   ```
2. Configure the server URL in the OpenHands UI (or VS Code setting) to:
   - `http://127.0.0.1:8001`
3. Ensure LLM credentials are set in the extension (VS Code secret storage):
   - `OpenHands: Set API Key` (required for remote conversations, since `RemoteConversation` forwards `settings.secrets.llmApiKey` to the server).
4. Send a simple message (e.g., “Say hi”) and confirm:
   - status transitions to `connecting` then `online`
   - a conversation id is created
   - events stream back via WebSocket

## Test matrix

### Server selection / mode

| Scenario | Steps | Expected |
|---|---|---|
| Local mode default | Ensure no server URL is selected | `mode=local`, local tools execute, local persistence works |
| Add server | Add `http://127.0.0.1:8001` in UI | Server appears in list; can be selected |
| Switch to remote | Select server in UI | `mode=remote`, status transitions, conversation starts remotely |
| Switch back to local | Use “Switch to local” | `mode=local`, remote connection torn down |
| Remove server | Remove current server | List updates; selection clears if removed |

### Connection lifecycle

| Scenario | Steps | Expected |
|---|---|---|
| Server running | Start server + select it | `connecting → online`, events arrive |
| Server down | Select server while not running | `offline` + clear error message (no hang) |
| Wrong port | Select `http://127.0.0.1:9999` | Same as “Server down” |
| WebSocket blocked | Allow HTTP but break WS (if reproducible) | Start conversation via HTTP; WS reconnect/backoff behavior is sensible; errors surface |
| Auth required (optional) | Set/clear `runtimeSessionApiKey` (if server enforces) | 401/403 surfaced with helpful message |

### Conversation flow (remote)

| Scenario | Steps | Expected |
|---|---|---|
| Start new conversation | Click “New” / run start | Server returns conversation id; UI shows it |
| Send message | Send “hello” | MessageEvent(s) and assistant response stream in |
| Pause/resume | Pause then resume | Server respects control endpoints; UI status updates |
| Reconnect | Trigger reconnect command | WS reconnects and continues streaming |
| Restore conversation | Restore a prior id | History replay happens; no duplicated events |

### Tooling / output

| Scenario | Steps | Expected |
|---|---|---|
| Terminal events (remote) | Run a prompt that triggers shell tool | Bash events appear in webview event stream; no local “OpenHands” PTY log is required in remote mode |
| File edits (remote) | Run a prompt that writes a file | Workspace changes happen as expected; errors are surfaced clearly |

## Notes for automation (E2E + CI)

- Start agent-server as a subprocess in test setup and wait for readiness (poll `/health`).
- Point the extension at the server by setting `openhands.serverUrl` (or using the server list message flow).
- Use existing diagnostics hooks (`openhands._diagnostics`, `_queryRenderedEvents`, `_queryUiState`) to assert:
  - connection status transitions
  - conversationStarted received
  - event stream is non-empty after sending a message
- Always include teardown with timeouts to avoid hung CI runs.
