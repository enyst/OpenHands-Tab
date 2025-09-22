# Product Requirements: OpenHands-Tab VS Code Extension

## 1. Objective
Deliver a VS Code extension that provides an in-IDE tab to interact with an OpenHands agent, using the agent-server (OpenHands server) to execute user prompts. The extension streams events in real time, previews proposed code changes, and lets users apply changes to their local workspace.

## 2. Scope
- In scope
  - VS Code extension with a dedicated tab (Webview) for chat and agent interaction
  - Connection to an OpenHands agent-server via WebSocket/HTTP
  - Real-time streaming of agent events (messages, tool runs, logs)
  - Display and apply code changes proposed by the agent to the local workspace
  - Basic session management: create/reset sessions, persist last session per workspace
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
  - WebSocket: Socket.IO endpoint /socket.io
    - Query params include conversation_id and latest_event_id, per OpenHands docs
    - Receives events: "oh_event"
    - Sends actions: "oh_user_action" (type: message)
  - HTTP endpoints (optional, as needed): create/list conversations, fetch history
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
- Connection & Session
  - Establish Socket.IO connection with conversation_id
  - If no conversation_id exists, create one via HTTP or let server auto-create if supported
  - Persist last used conversation_id per workspace (workspaceState); allow reset
  - Reconnect logic: exponential backoff; UI indicates connection state
- Chat & Streaming
  - Text input send -> oh_user_action: { type: "message", source: "user", message }
  - Render assistant messages and tool events as they stream
  - Show structured tool steps (bash/python commands, outputs, status)
  - Allow user to stop current run (best-effort)
- File Change Handling
  - Parse code edit events (diff/patch or content replace) from oh_event stream
  - Present list of proposed edits grouped by file
  - Diff preview: original vs proposed (VS Code diff editor)
  - Apply: write changes to workspace files; create files/directories as needed
  - Conflict handling: if local file changed since patch base, show conflict banner, require manual review
  - Batch apply and per-change apply
- Persistence
  - Store conversation_id and minimal transcript index for resume (workspaceState)
  - Store settings in standard VS Code Settings/SecretStorage
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
  - Resilient to transient Socket.IO disconnects

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
- Outbound (to server)
  - oh_user_action: { type: "message", source: "user", message: string }
  - Optional: cancel/run control if supported by server
- Inbound (from server via oh_event)
  - message events (assistant/system)
  - tool events (bash/python start, output, end, exit code)
  - code edit events: unified diff or file content replacement payloads
  - run lifecycle events (start, progress, end)

## 10. Extension Structure (Code)
- src/extension.ts (activate, register commands)
- src/connection/ConnectionManager.ts (Socket.IO client, HTTP helpers)
- src/session/SessionManager.ts (conversation_id, resume state)
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
