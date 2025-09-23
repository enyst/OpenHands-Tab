# OpenHands-Tab VS Code Extension

## 1. Objective
Deliver a VS Code extension that provides an in-IDE tab to interact with an OpenHands agent, using the agent-server (OpenHands server) to execute user prompts. The extension streams events in real time, supports action approval (confirmation mode), and reflects file changes in the workspace when the server runs against the workspace folder.

## 2. Scope
- In scope
  - VS Code extension with a dedicated tab (Webview) for chat and agent interaction
  - Connection to an OpenHands agent-server via WebSocket/HTTP
  - Real-time streaming of agent events (messages, tool runs, logs)
  - Display live agent activity and any resulting workspace file changes
  - Conversation management: start/restore conversations
  - Configuration UI for server URL and credentials
- Out of scope (v1)
  - Reproducing the full OpenHands web UI
  - Server lifecycle management (installing/running Docker, etc.)

  - Arbitrary tool configuration on the server (assumed to be preconfigured)

## 3. Target Users
- Developers who want to use OpenHands agents directly within VS Code
- Users with access to a local OpenHands agent-server

## 4. Architecture Overview
- VS Code Extension (Extension Host)
  - Activation + Commands
  - Connection Manager (WebSocket + HTTP proxy layer)
  - Session/State Manager (conversation lifecycle, persistence)
  - Telemetry/Logging (optional, off by default)
- Webview (Tab UI)
  - Chat composer and transcript
  - Streaming event view (tool outputs, logs)
  - Status/connection indicators
  - No dedicated diff viewer in the tab; file diffs open in standard VS Code editors/SCM. The tab may provide links to open those diffs.
- OpenHands Agent-Server (External)
  - Exposes native WebSocket API streaming EventBase JSON; accepts Message JSON
  - Executes tools (bash, python, web, etc.) in its own runtime/sandbox
  - Produces events that may include code edits or file operations (reflected in workspace)

Data flow notes
- Webview does not call the network directly. All network calls and WebSocket connections go through the Extension Host (to avoid CORS and webview limitations).
- Extension Host relays messages to/from the Webview via VS Code postMessage API.

## 5. External Dependencies & Protocol
- OpenHands Server (agent-server)
  - Default URL: http://localhost:3000 (local PoC)
  - WebSocket: native WebSocket endpoint /api/conversations/{conversation_id}/events/socket (JSON messages)
    - Inbound: server streams EventBase JSON objects
    - Outbound: client may send Message JSON to enqueue and run
  - HTTP endpoints:
    - POST /api/conversations to start a conversation (Agent, confirmation_policy, initial_message, max_iterations)
    - GET /api/conversations/search, /count, /{id}
    - POST /api/conversations/{id}/pause, /resume; DELETE /api/conversations/{id}
    - POST /api/conversations/{id}/events/ (SendMessageRequest) when not using the socket
    - GET /api/conversations/{id}/events/search, /count, /{event_id}, batch GET
    - POST /api/conversations/{id}/events/respond_to_confirmation to accept/reject pending actions
- Versions
  - Aim for compatibility with current OpenHands docs (WebSocket Connection guide)

## 6. Functional Requirements
- Commands
  - OpenHands: Open Tab (opens/activates the Webview)
  - OpenHands: Start New Conversation
  - OpenHands: Configure (opens settings quick-pick/form)
  - OpenHands: Reconnect (restarts WebSocket; rarely needed since reconnect is automatic)

  - OpenHands: Stop/Cancel Current Run (sends cancel if supported; otherwise disconnect/reconnect)
- Settings
  - openhands.serverUrl (string; default http://localhost:3000)
  - openhands.autoReconnect (boolean; default true)
- Connection & Conversation Lifecycle
  - Establish WebSocket connection to /api/conversations/{id}/events/socket
  - If no conversation_id exists, create one via POST /api/conversations with desired confirmation_policy
  - Maintain current conversation_id in workspaceState for convenience (for quick tab reload), independent of global persistence in ~/.openhands/conversations
  - Reconnect logic: exponential backoff; UI indicates connection state
- Chat & Streaming
  - Text input -> send Message JSON over socket or POST /events/
  - Render assistant messages and tool events (EventBase JSON) as they stream
  - Show structured tool steps (bash/python commands, outputs, status)
  - Allow user to stop/pause current run via POST /conversations/{id}/pause; resume via /resume
- Action Confirmation Mode
  - Policies: NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH, confirm_unknown: bool)
  - When agent status = WAITING_FOR_CONFIRMATION, surface pending actions in UI with Approve/Reject
  - Approve -> POST /api/conversations/{id}/events/respond_to_confirmation { accept: true }
  - Reject -> POST /api/conversations/{id}/events/respond_to_confirmation { accept: false, reason }
- File Change Handling
  - Reflect file system changes performed by the server in the connected workspace folder (no client-side patch application planned)
- Persistence
  - Store last-used conversation_id per workspace (workspaceState)
  - Store settings in standard VS Code Settings/SecretStorage
  - Conversation persistence (default ON):
    - Location: ~/.openhands/conversations (user-level; not tied to workspace)
    - Persist server/SDK JSON as-is (pydantic model_dump_json); no custom schema
- Telemetry/Logging
  - None by default; if enabled, only extension-level anonymized events (no content). Must be opt-in.

## 7. Non-Functional Requirements
- Security & Privacy
  - Secrets stored via VS Code SecretStorage
  - Do not log API keys or user content
  - All network traffic via Extension Host
- Performance
  - Stream updates without blocking the UI
  - Efficient diff rendering for typical file sizes (<1 MB per file in v1)
- Reliability
  - Graceful handling of server unavailability; retry with backoff
  - Resilient to transient WebSocket disconnects

## 8. UX Overview
- Tab Layout
  - Header: server status indicator (green/red dot), settings gear; reconnect is automatic; no separate New/Reset buttons in v1 (new conversation from command palette)
  - Main: message list (user/assistant and tool events), live streaming
  - Optional: show a lightweight list of recent file ops with links to open diffs in standard VS Code views (SCM/editor)
  - Bottom: chat composer with Send and Stop buttons
- Flows
  - First Run: prompt to configure server URL → test connection → create conversation → open tab
  - Send Prompt: user enters message → stream events → source control shows diffs → user reviews in standard editors/SCM
  - Reconnect: on disconnect, show banner; user can retry or auto-reconnect

## 9. API/Event Mapping (Initial)
- Outbound
  - WebSocket send: Message JSON (role/content) to queue and run
  - HTTP POST /api/conversations/{id}/events/: SendMessageRequest when needed outside the socket
  - Pause/Resume: POST /api/conversations/{id}/pause, /resume
  - Confirmation: POST /api/conversations/{id}/events/respond_to_confirmation
- Inbound
  - WebSocket: EventBase JSON stream (includes ActionEvent, MessageEvent, AgentErrorEvent, etc.)
  - HTTP: Events search/count for backfill on reconnect

## 10. Extension Structure (Code)
- src/extension.ts (activate, register commands)
- src/connection/ConnectionManager.ts (native WebSocket client, HTTP helpers)
- src/session/ConversationManager.ts (conversation_id, resume state)

- src/panels/OpenHandsPanel.ts (Webview setup, message bridge)
- webview-src/ (UI bundle; framework-agnostic or lightweight React)
  - ChatView, EventStream, StatusBar, SettingsModal

## 11. Packaging & Distribution
- Engine: VS Code >= 1.85.0
- Node: 22.x
- Publish as VSIX initially; Marketplace later
- Extension identifiers
  - Name: openhands-tab
  - Display Name: OpenHands Tab
  - Publisher: openhands

## 12. Milestones

## 14. Phased Delivery
- POC
  - Connect to server; create/restore conversation; send/stream messages and events
  - Minimal chat UI; basic status; reconnect handling
- Settings
  - Configure server URL; auto-reconnect; persist last conversation id
  - User-level persistence to ~/.openhands/conversations (default ON)
- Confirmation Mode
  - Surface WAITING_FOR_CONFIRMATION state; list pending actions; Approve/Reject flow
  - Policies selectable when starting a conversation (NeverConfirm, AlwaysConfirm, ConfirmRisky)
- Switch LLM During Conversation
  - If supported by server/SDK: expose command(s) to update agent model/provider mid-conversation
  - Otherwise: provide “Start New Conversation with Model…” flow
- UI Polish Rounds
  - Iteratively improve event rendering and layout
  - Note: OpenHands V0 (current web) vs V1 (agent-sdk centric) — we will prefer reusing visual patterns where feasible, but the authoritative APIs and models are from agent-sdk (V1 rewrite). Visual similarity is desired; implementation details may differ.

- M0: Scaffold extension + Webview shell; settings storage; connection test command
- M1: WebSocket connect; send message; render basic assistant text
- M2: Stream tool events/logs with structured UI; stop button
- M3: Error handling, reconnection, minimal telemetry (opt-in)
- M4: (Later) Revisit any optional file change summaries or links

## 13. Assumptions
- Server provides a stable EventBase WebSocket stream and accepts Message JSON per agent-sdk
- Server is responsible for model/provider configuration and tool availability

## 15. References
- agent-sdk (core models, agent/LLM abstractions)
  - openhands/sdk/agent/agent.py (Agent class, run loop, event generation)
  - openhands/sdk/llm/llm.py; utils/model_features.py; utils/metrics.py (model naming, metrics)
- agent-server (FastAPI service and WS/HTTP interface)
  - openhands/agent_server/README.md (WS endpoint, HTTP routes for conversations/events)
  - openhands/agent_server/conversation_service.py (StoredConversation meta save/load; conversations_path)
  - openhands/agent_server/event_service.py (event stream; persist meta via pydantic model_dump_json)
  - openhands/agent_server/routes/* (conversations, events, confirmation)
- Persistence utilities
  - openhands/sdk/io/local.py (LocalFileStore; expands "~"; basic sandboxing)
- Event/Conversation serialization
  - Pydantic model_dump/model_dump_json on Conversation/StoredConversation/EventBase
