# Product Requirements: OpenHands-Tab VS Code Extension

## 1. Objective
Deliver a VS Code extension that provides an in-IDE tab to interact with an OpenHands agent, using the agent-server (OpenHands server) to execute user prompts. The extension streams events in real time, supports action approval (confirmation mode), and reflects file changes in the workspace when the server runs against the workspace folder.

## 2. Scope
- In scope
  - VS Code extension with a dedicated tab (Webview) for chat and agent interaction
  - Connection to an OpenHands agent-server via WebSocket/HTTP
  - Real-time streaming of agent events (messages, tool runs, logs)
  - Display and apply code changes proposed by the agent to the local workspace
  - Conversation management: create/reset conversations, persist last conversation per workspace (by ID only)
  - Configuration UI for server URL and credentials
- Out of scope (v1)
  - Reproducing the full OpenHands web UI
  - Server lifecycle management (installing/running Docker, etc.)
  - Multi-tenant/team administration
  - Arbitrary tool configuration on the server (assumed to be preconfigured)

## 3. Target Users
- Developers who want to use OpenHands agents directly within VS Code
- Users with access to a running OpenHands agent-server (local or remote)

## 4. Architecture Overview
- VS Code Extension (Extension Host)
  - Activation + Commands
  - Connection Manager (WebSocket + HTTP proxy layer)
  - Session/State Manager (conversation lifecycle, persistence)
  - File Change Applier (apply patches to workspace)
  - Telemetry/Logging (optional, off by default)
- Webview (Tab UI)
  - Chat composer and transcript
  - Streaming event view (tool outputs, logs)
  - File changes list with inline diff preview and apply/revert controls
  - Status/connection indicators
- OpenHands Agent-Server (External)
  - Exposes WebSocket API to stream oh_event and accept oh_user_action
  - Executes tools (bash, python, web, etc.) in its own runtime/sandbox
  - Provides proposed code edits as patches/contents

Data flow notes
- Webview does not call the network directly. All network calls and WebSocket connections go through the Extension Host (to avoid CORS and centralize auth/secrets).
- Extension Host relays messages to/from the Webview via VS Code postMessage API.

## 5. External Dependencies & Protocol
- OpenHands Server (agent-server)
  - Default URL: http://localhost:3000 (configurable)
  - Authentication: API key/bearer token (optional, configurable)
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
  - OpenHands: New Session (creates a new agent conversation)
  - OpenHands: Configure (opens settings quick-pick/form)
  - OpenHands: Reconnect (restarts WebSocket)
  - OpenHands: Apply All Proposed Changes (batch apply)
  - OpenHands: Stop/Cancel Current Run (sends cancel if supported; otherwise disconnect/reconnect)
- Settings
  - openhands.serverUrl (string; default http://localhost:3000)
  - openhands.apiKey (secret storage)
  - openhands.autoReconnect (boolean; default true)
  - openhands.showTelemetryPrompt (boolean; default false)
- Connection & Conversation Lifecycle
  - Establish WebSocket connection to /api/conversations/{id}/events/socket
  - If no conversation_id exists, create one via POST /api/conversations with desired confirmation_policy
  - Persist last used conversation_id per workspace (workspaceState); allow reset
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
  - Reflect file system changes performed by the server in the connected workspace folder (no local patch application in v1)
  - Optional future: client-side patch preview/apply if running read-only server mode
- Persistence
  - Store last-used conversation_id per workspace (workspaceState)
  - Store settings in standard VS Code Settings/SecretStorage
  - Conversation persistence folder (optional, for local transcripts and metadata):
    - Default: .openhands/conversations in the first workspace folder
    - Each conversation: {conversation_id}.json (serialized events or minimal transcript)
    - Toggle to enable/disable local transcript persistence
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
  - Header: server status, session actions (New, Reset, Reconnect), settings gear
  - Main: message list (user/assistant and tool events), live streaming
  - Side panel: proposed file changes with counts
  - Bottom: chat composer with Send and Stop buttons
- Flows
  - First Run: prompt to configure server URL/API key → test connection → create session → open tab
  - Send Prompt: user enters message → stream events → proposed changes appear → user reviews → apply/skip
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
- src/edits/EditApplier.ts (diff parsing, apply, conflicts)
- src/panels/OpenHandsPanel.ts (Webview setup, message bridge)
- webview-src/ (UI bundle; framework-agnostic or lightweight React)
  - ChatView, EventStream, ChangesPanel, StatusBar, SettingsModal

## 11. Packaging & Distribution
- Engine: VS Code >= 1.85.0
- Node: 22.x
- Publish as VSIX initially; Marketplace later
- Extension identifiers
  - Name: openhands-tab
  - Display Name: OpenHands Tab
  - Publisher: enyst (placeholder)

## 12. Milestones
- M0: Scaffold extension + Webview shell; settings storage; connection test command
- M1: WebSocket connect; send message; render basic assistant text
- M2: Stream tool events/logs with structured UI; stop button
- M3: Parse and preview code edits; single-file apply
- M4: Batch apply; conflict detection; UX polish
- M5: Error handling, reconnection, minimal telemetry (opt-in)

## 13. Assumptions
- Server provides a stable oh_event stream and recognizes oh_user_action per current OpenHands docs
- Server is responsible for model/provider configuration and tool availability
- Code edits arrive as either unified diffs or full-file contents sufficient to apply locally
