# OpenHands-Tab VS Code Extension

## 1. Goal
A VS Code extension that provides a sidebar chat view to interact with OpenHands agents, supporting both local execution (in VS Code) and remote execution (via agent-server). The extension streams events in real time, supports action confirmation, and reflects file changes in the workspace.

## 2. Scope
- In scope
  - VS Code extension with a dedicated sidebar view (`WebviewView`) for chat and agent interaction
  - Local mode: run agent directly in VS Code using the SDK
  - Remote mode: connect to OpenHands agent-server via WebSocket/HTTP
  - Real-time streaming of agent events (messages, tool runs, logs)
  - Display live agent activity and workspace file changes
  - Conversation management: start/restore/history
  - Configuration UI for server URL, LLM settings, API keys
  - Action confirmation with security risk indicators
  - Skills system for extending agent capabilities
- Out of scope (v1)
  - Reproducing the full OpenHands web UI
  - Server lifecycle management (installing/running Docker, etc.)

## 3. Target
- Developers who want to use OpenHands agents directly within VS Code

## 4. Current Implementation Status

### Implemented Features ✓
- Activity bar icon and sidebar container
- Chat webview with streaming events and message rendering
- Local mode: full agent execution via SDK (Conversation API)
- Remote mode: WebSocket connection to agent-server with auto-reconnect
- Settings management via VS Code configuration + SecretStorage
- LLM configuration (model, temperature, API keys, etc.)
- Action confirmation with Approve/Reject UI
- Security risk indicators (LOW/MEDIUM/HIGH)
- Conversation persistence to disk
- Conversation history view (search + pagination)
- Attach files UI (inline text attachments)
- Workspace file context (@mentions)
- Skills support (~/.openhands/skills/)
- Terminal integration (local mode)
- Status banner for status and errors
- Event rendering for all event types

### Not Yet Implemented
- **Mid-conversation LLM switching (remote mode)** - must start a new conversation to change model; local mode applies settings updates live

**Deferred (requires human approval)**
- **MCP integration / MCP server selection** - UI placeholders exist but are intentionally deferred; not a priority; do not work on this without explicit approval from a human maintainer

## 5. Architecture Overview

### Extension Host
- **Activation + Commands** (`src/extension.ts`)
- **Connection Manager** (`src/connection/`) - WebSocket + HTTP proxy layer
- **Session/Conversation Manager** (`src/session/`) - conversation lifecycle
- **Settings Manager** (`src/settings/`) - VS Code config + SecretStorage

### Webview (React)
- **Main App** (`src/webview-src/components/App.tsx`)
- **EventBlock** - renders all event types
- **InputArea** - chat input with context picker
- **HistoryView** - conversation history
- **ConfirmationPrompt** - action approval UI

### SDK (@openhands/agent-sdk-ts)
- **Conversation Layer** - primary API (`Conversation()` factory)
  - `LocalConversation` - in-process agent execution
  - `RemoteConversation` - WebSocket to agent-server
- **Context Layer** - AgentContext, Skills
- **Runtime Layer** - AgentOrchestrator, EventLog, ConversationState
- **LLM Layer** - Anthropic, OpenAI-compatible clients
- **Tools Layer** - Terminal, FileEditor, TaskTracker, Browser, Glob, Grep

### Data Flow
- Webview does not call network directly
- All network calls go through Extension Host
- Extension Host relays messages via VS Code postMessage API

## 6. External Dependencies & Protocol

### Agent-Server (Remote Mode)
- Default URL: `http://localhost:3000`
- WebSocket: `/sockets/events/{conversation_id}`
- HTTP endpoints:
  - POST `/api/conversations` - create
  - POST `/api/conversations/{id}/pause` - pause
  - POST `/api/conversations/{id}/run` - resume
  - POST `/api/conversations/{id}/events/respond_to_confirmation` - approve/reject
  - GET `/api/conversations/{id}/events/` - list events
- Auth: X-Session-API-Key header (HTTP), ?session_api_key query param (WebSocket)

### Message Format
```json
{ "role": "user", "content": [{ "type": "text", "text": "..." }] }
```

### Confirmation Policy
- NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH)

## 7. Functional Requirements

### Commands
- **OpenHands: Open** - reveals/focuses the chat sidebar view
- **OpenHands: Start New Conversation** - starts fresh conversation
- **OpenHands: Configure** - multi-step configuration wizard
- **OpenHands: Set API Key** - quick API key setup
- **OpenHands: Reconnect** - restart WebSocket (rarely needed)
- **OpenHands: Pause Current Run** - pause agent
- **OpenHands: Resume Current Run** - resume agent

### Settings (package.json)
- `openhands.serverUrl` - agent-server URL (blank for local mode)
- `openhands.llm.model` - default model
- `openhands.llm.temperature`, `topP`, `maxOutputTokens`, etc.
- `openhands.confirmation.policy` - never/always/risky
- `openhands.conversation.maxIterations` - iteration limit

### Connection & Conversation Lifecycle
- Local mode: SDK runs agent in-process
- Remote mode: WebSocket to agent-server
- Conversation ID stored in workspaceState
- Auto-reconnect with exponential backoff

### Chat & Streaming
- User input sends Message JSON
- Events stream in real-time (MessageEvent, ActionEvent, ObservationEvent, etc.)
- Tool results displayed with collapsible details

### Action Confirmation
- When agent status = WAITING_FOR_CONFIRMATION, show pending actions
- Approve/Reject buttons with optional reason

### Persistence
- Conversation history in ~/.openhands/conversations (default ON)
- Server/SDK JSON persisted as-is

## 8. Non-Functional Requirements
- **Security**: Secrets in VS Code SecretStorage, no API keys in logs
- **Performance**: Stream updates without blocking UI
- **Reliability**: Auto-reconnect, graceful error handling

## 9. UX Overview

### Activity Bar
- OpenHands icon opens the OpenHands view container (chat lives in the sidebar)
- No separate “quick actions” view; actions are available in the chat header and via the command palette

### Chat View Layout
- **Header**: connection status, settings button, history button
- **Main**: message list with streaming events
- **Bottom**: input area with context picker (@), skills button

### Flows
- First run: prompt to configure API key
- Send message: stream events, show tool execution
- Confirmation: display pending action with Approve/Reject

## 10. Extension Structure

```
src/
├── extension.ts                 # Entry point, commands
├── connection/
│   └── ConnectionManager.ts     # WebSocket/HTTP, conversation lifecycle
├── session/
│   └── ConversationManager.ts   # Conversation state management
├── settings/
│   ├── SettingsManager.ts       # Settings access layer
│   └── VscodeSettingsAdapter.ts # VS Code implementation
├── sidebar/
│   └── OpenHandsViewProvider.ts # Activity bar tree view
└── webview-src/
    ├── webview.tsx              # Entry point
    └── components/
        ├── App.tsx              # Main component
        ├── EventBlock.tsx       # Event rendering
        ├── InputArea.tsx        # Chat input
        ├── HistoryView.tsx      # Conversation history
        └── ConfirmationPrompt.tsx
```

## 11. Packaging & Distribution
- Engine: VS Code >= 1.104.0
- Node: 22.x
- Publish as VSIX; Marketplace later
- Extension ID: openhands.openhands-tab

## 12. Implementation Phases

### POC ✓ Complete
- Connect to server, create/restore conversation, send/stream messages
- Minimal chat UI, basic status, reconnect handling

### Settings ✓ Complete
- Server URL, LLM configuration, API key storage
- Multi-step configuration wizard
- VS Code SecretStorage integration

### Confirmation Mode ✓ Complete
- WAITING_FOR_CONFIRMATION state, Approve/Reject flow
- Security risk indicators

### Local Mode ✓ Complete
- Full agent execution via SDK
- Terminal integration for command output

### Activity Bar ✓ Complete
- Custom icon and sidebar container

### Chat Toolbar ✓ Complete
- New Conversation, Settings, Connection status
- Context picker (@mentions)
- Skills button

### Conversation History ✓ Complete
- History view with conversation list
- Title and prompt preview

### TODO: Future Enhancements
- **Attach Files (images/binary)** - richer attachment support beyond text
- **MCP Integration** - DEFERRED until further notice; requires explicit human approval to work on
- **Mid-Conversation Model Switch** - change LLM without new conversation
- **Advanced History** - export + richer metadata (and server-backed history if needed)

## 13. References
- [agent-sdk](https://github.com/All-Hands-AI/agent-sdk) - Python SDK and agent-server
- [agent-sdk-architecture.md](agent-sdk-architecture.md) - SDK architecture
- [settings_prd.md](settings_prd.md) - Settings system details
