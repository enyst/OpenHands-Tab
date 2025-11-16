# OpenHands-Tab VS Code Extension

## 1. Goal
A VS Code extension that provides a tab to interact with the OpenHands agent, using the agent-server (OpenHands server) to execute user prompts. The extension streams events in real time, supports action approval (confirmation mode), and reflects file changes in the workspace when the server runs against the workspace folder.

## 2. Scope
- In scope
  - VS Code extension with a dedicated tab (Webview) for chat and agent interaction
  - Connection to an OpenHands agent-server via WebSocket/HTTP
  - Real-time streaming of agent events (messages, tool runs, logs)
  - Display live agent activity and any resulting workspace file changes
  - Conversation management: start/restore conversations
  - Configuration UI for server URL
- Out of scope (v1)
  - Reproducing the full OpenHands web UI
  - Server lifecycle management (installing/running Docker, etc.)
  - Arbitrary tool configuration on the server (assumed to be preconfigured)

## 3. Target
- Developers who want to use OpenHands agents directly within VS Code

## 4. Architecture Overview
- VS Code Extension (Extension Host)
  - Activation + Commands
  - Connection Manager (WebSocket + HTTP proxy layer)
  - Session/State Manager (conversation lifecycle, persistence)
  - Logging (debug)
- Webview (Tab UI)
  - User messages entry (chat box)
  - Streaming event view (tool outputs, agent messages, user messages)
  - logs/system informations
  - Status/connection indicators
  - No dedicated diff viewer in the tab; file diffs open in standard VS Code editors/SCM. The tab may provide links to open those diffs.
- OpenHands Agent-Server (External)
  - Exposes native WebSocket API streaming EventBase JSON; accepts Message JSON
  - Executes tools (bash, python, web, etc.) in its own runtime
  - Produces events that may include code edits or file operations (reflected in workspace)

Data flow notes
- Webview does not call the network directly. All network calls and WebSocket connections go through the Extension Host (to avoid CORS and webview limitations).
- Extension Host relays messages to/from the Webview via VS Code postMessage API.

## 5. External Dependencies & Protocol
- OpenHands Server (agent-server)
  - Default URL: http://localhost:3000 (local PoC)
  - WebSocket: /sockets/events/{conversation_id} (JSON)
    - Inbound: server streams EventBase JSON objects
    - Outbound: send Message JSON to enqueue and run
    - Message payload (WS/HTTP): { "role": "user", "content": [{ "type": "text", "text": "..." }] }
    - Session API key (optional): if enabled on server, use X-Session-API-Key header for HTTP and add ?session_api_key=... to the WebSocket URL
    - Note: `{id}` in HTTP routes refers to the same value as `{conversation_id}` in WS paths.
  - HTTP endpoints:
    - Conversations:
      - POST /api/conversations
      - GET  /api/conversations/search
      - GET  /api/conversations/count
      - GET  /api/conversations/{id}
      - GET  /api/conversations/                      (list)
      - POST /api/conversations/{id}/pause
      - POST /api/conversations/{id}/run
      - DELETE /api/conversations/{id}
    - Events:
      - POST /api/conversations/{id}/events/          (send Message when not using the socket)
      - GET  /api/conversations/{id}/events/search
      - GET  /api/conversations/{id}/events/count
      - GET  /api/conversations/{id}/events/{event_id}
      - GET  /api/conversations/{id}/events/          (list)
      - POST /api/conversations/{id}/events/respond_to_confirmation  (approve/reject pending actions)
    - StartConversationRequest payloads must use the agent-server 1.1+ tool identifiers (`terminal`, `file_editor`, `task_tracker`); older names like `BashTool` are rejected.

Confirmation policy
- By default, if unspecified in StartConversationRequest, server uses its configured default policy (often NeverConfirm for PoC/local). The extension omits confirmation_policy by default and will surface WAITING_FOR_CONFIRMATION if server asks.
- Policies supported: NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH, confirm_unknown: bool)
- If we later expose UI to select a policy, we’ll send it in the POST /api/conversations payload.

## 6. Functional Requirements
- Commands
  - OpenHands: Open Tab (opens/activates the Webview)
  - OpenHands: Start New Conversation
  - OpenHands: Configure (opens input box to set server URL)
  - OpenHands: Reconnect (restarts WebSocket; rarely needed since reconnect is automatic)
  - OpenHands: Pause Current Run (sends pause)
  - OpenHands: Resume Current Run (sends run)
- Settings
  - openhands.serverUrl (string; default http://localhost:3000)
  - See settings_prd.md for detailed settings (server connection/auth, LLM parameters, confirmation policy, and runtime mapping) and rationale
- Connection & Conversation Lifecycle
  - Establish WebSocket connection to /sockets/events/{conversation_id}
  - If no conversation_id exists, create one via POST /api/conversations with desired confirmation_policy
  - Maintain current conversation_id in workspaceState for convenience (for quick tab reload)
  - Reconnect logic: exponential backoff; UI indicates connection state
- Chat & Streaming
  - Text input -> send Message JSON over socket or POST /events/
  - Render assistant messages and tool events (EventBase JSON) as they stream
  - Show structured tool steps (bash/python commands, outputs, status)
  - Allow user to pause current run via POST /conversations/{id}/pause; resume via /run
- Action Confirmation Mode
  - Policies: NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH, confirm_unknown: bool)
  - When agent status = WAITING_FOR_CONFIRMATION, surface pending actions in UI with Approve/Reject
  - Approve -> POST /api/conversations/{id}/events/respond_to_confirmation { accept: true }
  - Reject -> POST /api/conversations/{id}/events/respond_to_confirmation { accept: false, reason }
- Persistence
  - Store last-used conversation_id per workspace (workspaceState)
  - Store settings in standard VS Code Settings/SecretStorage
  - Conversation persistence (default ON):
    - Location: ~/.openhands/conversations
    - Persist server/SDK JSON as-is (pydantic model_dump_json); no custom schema
- Logging
  - For debugging.

## 7. Non-Functional Requirements
- Security & Privacy
  - Secrets stored via VS Code SecretStorage
  - Do not log API keys or user content
  - All network traffic via Extension Host
- Performance
  - Stream updates without blocking the UI
- Reliability
  - Graceful handling of server unavailability; retry with backoff
  - Resilient to transient WebSocket disconnects

## 8. UX Overview
- Tab Layout
  - Header: server status indicator (green/red dot), settings gear
  - Main: message list (user/assistant and tool events), live streaming
  - Tool results can be file editor results, show links for filenames so the user can see the diff in the main editor
  - Bottom: chat composer with Send and Stop buttons
- Flows
  - First Run: prompt to configure server URL → create conversation → open tab
  - Send Prompt: user enters message → stream events → source control shows diffs → user reviews in standard editors/SCM
  - Reconnect: on disconnect, show banner; user can retry or auto-reconnect

## 9. API/Event Mapping (Initial)
- Outbound
  - WebSocket send: Message JSON (role/content) to queue and run
  - HTTP POST /api/conversations/{id}/events/: SendMessageRequest when needed outside the socket
  - Pause/Resume: POST /api/conversations/{id}/pause, /run
  - Confirmation: POST /api/conversations/{id}/events/respond_to_confirmation
- Inbound
  - WebSocket: EventBase JSON stream (includes ActionEvent, MessageEvent, AgentErrorEvent, etc.)
  - HTTP: Events search/count for backfill on reconnect

## 10. Extension Structure (Code)
- src/extension.ts (activate, register commands, webview setup, message bridge)
- src/connection/ConnectionManager.ts (native WebSocket client, HTTP helpers)
- src/session/ConversationManager.ts (conversation_id, resume state)
- src/types/agent-sdk.ts (TypeScript types and guards for Message/Event models)
- src/webview-src/ (React UI bundle)
  - webview.tsx (entry point)
  - components/App.tsx (main React component with chat UI, event stream, status)
  - TODO: Separate components for EventStream, SettingsModal if needed for better organization

## 11. Packaging & Distribution
- Engine: VS Code >= 1.104.0
- Node: 22.x
- Publish as VSIX initially; Marketplace later
- Extension identifiers
  - Name: openhands-tab
  - Display Name: OpenHands Tab
  - Publisher: openhands

## 12. Phases
- POC
  - Connect to server; create/restore conversation; send/stream messages and events
  - Minimal chat UI; basic status; reconnect handling
- Settings
  - Configure server URL; auto-reconnect; persist last conversation id
  - User-level persistence to ~/.openhands/conversations (default ON)
- Confirmation Mode
  - Surface WAITING_FOR_CONFIRMATION state; list pending actions; Approve/Reject flow
  - Policies selectable when starting a conversation (NeverConfirm, AlwaysConfirm, ConfirmRisky)

- Live Bash Events Terminal
  - Stream bash command output to VS Code integrated terminal via /sockets/bash-events
  - See bash_events.md for full feature specification

- TODO: Switch LLM During Conversation
  - If supported by server/SDK: expose command(s) to update agent model/provider mid-conversation
  - Otherwise: provide "Start New Conversation with Model…" flow
  - Note: LLM is configurable via settings; mid-conversation switching not yet implemented
- UI Polish Rounds
  - Iteratively improve event rendering and layout
  - Note: OpenHands V0 (current web) vs V1 (agent-sdk centric) — we will prefer reusing visual patterns where feasible, but the authoritative APIs and models are from agent-sdk (V1 rewrite). Visual similarity is desired; implementation details may differ.

- Activity Bar & Tab UX (vscode-ext-bugs scope)
  - Clicking the OpenHands activity bar icon opens the chat webview panel.
  - Persistent top toolbar within the tab (visible on all screens):
    - **New Conversation** icon (starts a fresh session and navigates to the conversation view)
    - **History** icon (placeholder; will navigate to conversation history when implemented)
    - **Settings** icon (opens VS Code Settings targeting `openhands.*`—uses `workbench.action.openSettings` with the extension filter, not a custom modal)
    - **Connection toggle** icon:
      - Shows a ✓/connected state when WebSocket is online, X/disconnected state otherwise.
      - Clicking attempts connect/reconnect (invokes existing `reconnect` logic when offline, no-op when online until we add explicit disconnect).
  - Conversation view layout:
    - The top toolbar remains visible across all states.
    - Main content shows streamed events (existing behaviour).
    - Prompt input area at the bottom without a dedicated “Send” button; pressing Enter submits.
    - A secondary control strip directly below the input with icon buttons (left-to-right):
      - `@` (tooltip: “Add context”) – reserved hook for future context attachment flow.
      - `+` (tooltip: “Attach files”) – reserved for attachment picker.
      - `MCP` (tooltip: “MCP Servers”) – reserved for MCP integration UI.
      - Skill icon (tooltip: “Skills”) – reserved for skill/microagent selector.
    - Icons emit no-ops initially; they exist to establish the layout.

- M0: Scaffold extension + Webview shell; settings storage; connection test command
- M1: WebSocket connect; send message; render basic assistant text
- M2: Stream tool events/logs with structured UI; stop button
- M3: Error handling, reconnection, minimal telemetry (opt-in)
- M4: (Later) Revisit any optional file change summaries or links

## 13. Assumptions
- Server provides a stable EventBase WebSocket stream and accepts Message JSON per agent-sdk
- Server is responsible for model/provider configuration and tool availability

## 14. References
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

## 15. Protocol & Schema Reference (Authoritative)
- WebSocket endpoints (agent-sdk):
  - Conversation events: /sockets/events/{conversation_id}?session_api_key=...
  - Bash events: /sockets/bash-events?session_api_key=...
  - Source: agent-sdk/openhands/agent_server/sockets.py
- HTTP endpoints (agent-sdk):
  - Conversations:
    - POST /api/conversations
    - GET  /api/conversations/search
    - GET  /api/conversations/count
    - GET  /api/conversations/{id}
    - GET  /api/conversations/                      (list)
    - POST /api/conversations/{id}/pause
    - POST /api/conversations/{id}/run
    - DELETE /api/conversations/{id}
  - Events:
    - POST /api/conversations/{id}/events/
    - GET  /api/conversations/{id}/events/search
    - GET  /api/conversations/{id}/events/count
    - GET  /api/conversations/{id}/events/{event_id}
    - GET  /api/conversations/{id}/events/          (list)
    - POST /api/conversations/{id}/events/respond_to_confirmation
  - Source: agent-sdk/openhands/agent_server/{conversation_router.py,event_router.py}
- Bash events schema (received over WS at /sockets/bash-events):
  - Base: BashEventBase; page type: BashEventPage
  - File: agent-sdk/openhands/agent_server/models.py
  - Minimal example (BashOutput):
    {
      "type": "BashOutput",
      "command_id": "<UUID>",
      "order": 0,
      "exit_code": null,
      "stdout": "...",
      "stderr": null,
      "id": "<UUID>",
      "timestamp": "2025-01-01T00:00:00Z"
    }
  - Notes: This socket streams bash command lifecycle events (e.g., BashCommand, BashOutput). The extension may choose to subscribe for live terminal output; authentication matches the Event socket.

- Message schema (send over WS/HTTP):
  - Class: openhands.sdk.llm.message.Message (+ TextContent, ImageContent)
  - File: agent-sdk/openhands/sdk/llm/message.py
  - Minimal example:
    { "role": "user", "content": [{ "type": "text", "text": "Hello" }] }
  - Notes: tool_calls, tool_call_id, name, reasoning_content are supported when relevant.
- Event schema (received over WS):
  - Base: openhands.sdk.event.base.EventBase (discriminated union)
  - Common event types:
    - MessageEvent: agent-sdk/openhands/sdk/event/llm_convertible/message.py
    - ActionEvent: agent-sdk/openhands/sdk/event/llm_convertible/action.py
    - Observation events: agent-sdk/openhands/sdk/event/llm_convertible/observation.py
    - Plus system/agent error events per openhands.sdk.event
  - Event pages: EventPage in agent-sdk/openhands/agent_server/models.py
- Auth:
  - HTTP: X-Session-API-Key header when enabled
  - WebSocket: session_api_key query parameter

## 16. TypeScript Model Alignment and @openhands/ui Adoption Plan

IMPORTANT: see also IMPLEMENTATION_PLAN.md for the step-by-step implementation and test plan.

Source of truth
- Agent-server (agent-sdk) is the authoritative API/protocol. If any mismatch occurs between V0 and V1 assets, prefer agent-sdk.

1) Data Model Alignment (prevent drift)
- Goal: Mirror the minimal Message and Event models from agent-sdk in TypeScript to ensure send/receive parity and catch drift early.
- Scope:
  - Message (WS/HTTP send): role in {user, assistant, system, tool}; content: Array<TextContent | ImageContent>.
  - Event stream (WS receive): EventBase discriminated union with common variants (MessageEvent, ActionEvent, Observation*, AgentErrorEvent, etc.).
  - EventPage for HTTP backfill: { items: EventBase[]; next_page_id?: string | null }.
- Implementation:
  - Create src/types/agent-sdk.ts exporting Message, TextContent, ImageContent, and a narrowed EventBase union.
  - Add type guards for event decoding; unknown variants are logged and rendered as raw JSON.
  - Wire types into ConnectionManager: onEvent(e: EventBase), sendUserMessage(payload: Message).
  - Update renderers to switch on event.type; fallback to JSON view for unknowns.
- Anchors (comments only, no codegen yet):
  - openhands/sdk/llm/message.py
  - openhands/sdk/event/llm_convertible/{message.py,action.py,observation.py}
  - openhands/agent_server/models.py (EventPage)
- Future option: introduce codegen/tests if we see drift.

2) @openhands/ui Adoption (selective, incremental)
- Goal: Reuse OpenHands component styles for consistency while keeping agent-sdk protocol intact.
- Constraints: @openhands/ui (V0 era, July) may not match V1 needs; where conflicts arise, prefer agent-sdk and our own choices.
- Approach:
  - Webview bundle imports @openhands/ui and "@openhands/ui/styles" (compiled CSS). No Tailwind at runtime.
  - Incremental replacement: buttons, typography, scrollable containers first; then tooltips/chips/event cards.
  - Pin @openhands/ui ~= 1.0.0-beta.9; validate upgrades.
  - Monitor bundle size; keep layout simple and accessible; align with VS Code look later.

3) Milestones
- M-A (Models): Add src/types/agent-sdk.ts + type guards; update ConnectionManager and renderers to use types.
- M-B (Webview Foundation): Ensure React bundling in webview supports @openhands/ui/styles.
- M-C (UI Increment 1): Adopt Button, Typography, basic containers.
- M-D (UI Increment 2): Tooltips, Chips, richer event cards.
- M-E (Polish): Theme mapping to VS Code, accessibility, docs.

4) Risks and decisions
- React/tailwind peer constraints are confined to the webview bundle; we ship compiled assets.
- If UI library imposes constraints that hinder VS Code UX, we prioritize agent-sdk-compliant functionality over stylistic fidelity.
