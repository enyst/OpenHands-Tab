# OpenHands-Tab VS Code Extension

## 1. Goal
A VS Code extension that provides a sidebar chat view to interact with OpenHands agents, supporting both local execution (in VS Code) and remote execution (via agent-server). The extension streams events in real time, supports action confirmation, and reflects file changes in the workspace.

## 2. Scope

### In scope
- VS Code extension with a dedicated sidebar view (`WebviewView`) for chat and agent interaction
- Local mode: run agent directly in VS Code using the SDK
- Remote mode: connect to OpenHands agent-server via WebSocket/HTTP
- Real-time streaming of agent events (messages, tool runs, logs)
- Display live agent activity and workspace file changes
- Conversation management: start/restore/history (local persistence)
- Configuration via VS Code Settings + SecretStorage + LLM Profiles view
- Action confirmation with security risk indicators (LOW/MEDIUM/HIGH)
- Skills file picker (local `~/.openhands/skills`)
- Terminal integration for local tool execution
- HAL high-risk confirmation flow (optional)

### Out of scope (v1)
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
- LLM configuration via profiles (model, base URL, parameters, per-profile keys)
- Action confirmation with Approve/Reject UI
- Security risk indicators (LOW/MEDIUM/HIGH)
- Conversation persistence to disk (local mode)
- Conversation history view (local history scan)
- Attachments UI (text attachments + inline image paste)
- Workspace file context (@mentions)
- Skills browser (local `~/.openhands/skills`)
- Tools picker (local mode only)
- Terminal integration (local mode)
- Status banner for status and errors
- Event rendering for all event types (including condensation summaries)

### Not Yet Implemented
- **Mid-conversation LLM switching (remote mode)** - must start a new conversation to change model; local mode applies settings updates live

**Deferred (requires human approval)**
- **MCP integration / MCP server selection** - not implemented; requires explicit approval from a human maintainer

## 5. Architecture Overview

### Extension Host
- **Activation + Commands** (`src/extension.ts`)
- **Conversation Manager** (`src/conversation/host/`) - conversation lifecycle
- **Settings Manager** (`src/settings/`) - VS Code config + SecretStorage
- **Shared Utilities** (`src/shared/`) - shared types and utilities
- **Webview Host** (`src/webview/host/`) - webview host integration

### Webview (React)
- **Main App** (`src/webview-src/components/App.tsx`)
- **EventBlock** - renders all event types
- **InputArea** - chat input with context picker
- **HistoryView** - conversation history
- **ConfirmationPrompt** - action approval UI
- **LlmProfilesView** - profile management slide-over panel

### SDK (@openhands/agent-sdk-ts)
- **Conversation Layer** - primary API (`Conversation()` factory)
  - `LocalConversation` - in-process agent execution
  - `RemoteConversation` - WebSocket to agent-server
- **Context Layer** - AgentContext, Skills
- **Runtime Layer** - LLMStreamer, EventLog, ConversationState
- **LLM Layer** - Anthropic, OpenAI-compatible clients
- **Tools Layer** - Terminal, FileEditor, TaskTracker, Browser, Glob, Grep, BrowserUse, PlanningFileEditor, Delegate

### Data Flow
- Webview does not call network directly
- All network calls go through Extension Host
- Extension Host relays messages via VS Code postMessage API

## 6. External Dependencies & Protocol

### Agent-Server (Remote Mode)
- WebSocket: `/sockets/events/{conversation_id}`
- HTTP endpoints:
  - POST `/api/conversations` - create
  - POST `/api/conversations/{id}/pause` - pause
  - POST `/api/conversations/{id}/run` - resume
  - POST `/api/conversations/{id}/events/respond_to_confirmation` - approve/reject
  - GET `/api/conversations/{id}/events/` - list events
- Auth: X-Session-API-Key header (HTTP), `?session_api_key` query param (WebSocket)

### Message Format
```json
{ "role": "user", "content": [{ "type": "text", "text": "..." }] }
```

### Confirmation Policy
- NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH)

## 7. Functional Requirements

### Commands
- **OpenHands: Open** - reveals/focuses the chat sidebar view
- **OpenHands: Explain Selection** - opens the sidebar and starts a new conversation from the editor selection
- **OpenHands: Start New Conversation** - starts fresh conversation
- **OpenHands: Configure** - opens the VS Code Settings page for the extension
- **OpenHands: Set API Key** - set global fallback LLM API key
- **OpenHands: Set OpenAI API Key**
- **OpenHands: Set Anthropic API Key**
- **OpenHands: Set OpenRouter API Key**
- **OpenHands: Set LiteLLM Proxy API Key**
- **OpenHands: Set Gemini API Key**
- **OpenHands: Set Session API Key** - set agent-server auth key
- **OpenHands: Set GitHub Token**
- **OpenHands: Set HAL TTS API Key**
- **OpenHands: Set Custom Secret 1/2/3**
- **OpenHands: Reconnect** - restart WebSocket (rarely needed)
- **OpenHands: Pause Current Run** - pause agent
- **OpenHands: Resume Current Run** - resume agent

### Settings (package.json)
- `openhands.serverUrl` - agent-server URL (blank for local mode)
- `openhands.servers` - saved server list [{ url, label? }]
- `openhands.llm.profileId` - selected LLM profile id from `~/.openhands/llm-profiles` (local alias; remote mode expands into `agent.llm` fields, no `profile_id` sent)

For internal diagnostics and the dev logging bridge, see docs/vscode_local_setup.md.
- `openhands.agent.enableSecurityAnalyzer`
- `openhands.agent.debug` (local debug events)
- `openhands.agent.summarizeToolCalls` (local-only, Gemini)
- `openhands.devBridge.enabled` (debug logging bridge)
- `openhands.confirmation.policy` - never/always/risky
- `openhands.confirmation.risky.threshold` default MEDIUM
- `openhands.confirmation.risky.confirmUnknown`
- `openhands.hal.*` (HAL high-risk confirmation settings)
- `openhands.conversation.maxIterations`
- `openhands.conversation.storeRoot` (local persistence path override)
- `openhands.terminal.renderProgress`
- `openhands.secrets.*` (status-only indicators, not actual secret storage)

For detailed settings behavior, see `docs/settings_prd.md`.

### Connection & Conversation Lifecycle
- Local mode: SDK runs agent in-process
- Remote mode: WebSocket to agent-server
- LLM Profiles (remote): agent-server schema is strict and rejects unknown fields (e.g. `llm.profile_id`), so the extension/SDK resolves `openhands.llm.profileId` locally and expands it into the existing `agent.llm` payload (model/baseUrl/etc).
- Conversation IDs stored in workspaceState (`openhands.conversationId.local` / `openhands.conversationId.remote`)
- Auto-reconnect with exponential backoff

### Chat & Streaming
- User input sends Message JSON
- Events stream in real-time (MessageEvent, ActionEvent, ObservationEvent, etc.)
- Tool results displayed with collapsible details

### Condensation (token-budget based; local mode)
- Local mode only: when the next LLM request would exceed the configured input token budget (profile `maxInputTokens`), the SDK summarizes prior events and emits a `Condensation` event.
- If the provider returns a context-limit error, the SDK will attempt condensation and retry (up to 2 condensation attempts per agent step). If no `maxInputTokens` is configured, this fallback path uses a default budget of 8000 tokens.
- The `Condensation` event contains:
  - `summary`: injected into the system prompt inside `<CONVERSATION SUMMARY>…</CONVERSATION SUMMARY>`
  - `forgotten_event_ids`: message event ids omitted from future requests
- User-facing behavior: the webview renders a “Conversation Summarized” block with the summary and the number of forgotten events; the chat continues normally.

### Action Confirmation
- When agent status = WAITING_FOR_CONFIRMATION, show pending actions
- Approve/Reject buttons with optional reason
- Optional HAL flow for high-risk confirmations

### Persistence
- Local history is stored under `~/.openhands/conversations-vscode/` by default (override with `openhands.conversation.storeRoot`).
- Remote mode relies on the agent-server for persistence; the local history view only surfaces locally stored conversations.

### Workspace Folder Selection (multi-root workspaces)

**Problem:** The extension currently assumes a single workspace root and frequently uses `vscode.workspace.workspaceFolders?.[0]` as "the" `workspaceRoot`. This works for single-folder workspaces, but breaks/limits multi-root workspaces and prevents switching the agent's working folder mid-stream.

**Current behavior audit (examples):**
- Conversation `workspaceRoot` is derived from `workspaceFolders?.[0]?.uri.fsPath` in the extension host and passed into the SDK `Conversation(...)` creation.
- Remote mode also uses that same `workspaceRoot` as `workspace.working_dir` when creating a remote conversation; the SDK’s remote workspace client uses `working_dir` as the default directory for tool calls.
- Host-side path helpers (e.g., resolving relative file paths) and settings reads/writes are often scoped to the first workspace folder.

**Recommended approach (v1): "Conversation is bound to one workspaceFolder"**
- Each conversation is created with a selected `workspaceFolder` (identified by `workspaceFolder.uri.toString()`; `fsPath` used as the `workspaceRoot`).
- If the user wants to "switch folders", we **start a new conversation** bound to the newly selected folder (rather than mutating the workspace root of an existing in-flight conversation).
  - Rationale: avoids mixing tool sandbox roots, keeps persistence semantics simple, and matches remote-mode constraints (agent-server conversations are created with a single `working_dir`).

**UX touchpoints:**
- At start (multi-root only): prompt for a workspace folder (QuickPick) or allow choosing from a header dropdown; default to "last used folder" for that VS Code workspace if available, else `workspaceFolders?.[0]`.
- Mid-stream: add a command like **"OpenHands: Switch Conversation Workspace Folder..."**.
  - Behavior: confirm with the user, then start a new conversation in the selected folder (optionally carrying a short summary forward as a system message in a future enhancement).
- In the chat header, show the active folder name (and optionally the relative path) so it’s always visible.

**Persistence and restore:**
- Persist the selected workspace folder identifier alongside the conversation metadata (local mode) so restoring a conversation can re-bind to the same folder.
- If the workspace folder no longer exists (removed/renamed), prompt the user to choose a new folder and clearly indicate the rebinding in the UI.

**Remote-mode considerations:**
- The selected folder should populate `workspace.working_dir` when creating remote conversations.
- If the server enforces its own workspace root or rejects the provided `working_dir`, surface a clear status error and fall back to server-defined behavior.

**Key technical changes (to be implemented later, not in this PRD bead):**
- Centralize "workspace root resolution" so host helpers accept an explicit `workspaceRoot` (derived from the selected folder) rather than reading `workspaceFolders?.[0]` directly.
- Update all places that assume "folder 0" (conversation creation, file path resolution, git/diff root resolution, settings scope, context picker, history metadata) to use the selected folder.

**Testing strategy (to implement later):**
- Unit tests: workspace folder selection persistence, path resolution under different roots, behavior when folder is missing.
- E2E test: open a multi-root workspace with two folders; start a conversation in folder A, create a file via tool; switch to folder B, create a different file; verify files land in the correct folders and the UI indicates the active folder correctly.

## 8. Non-Functional Requirements
- **Security**: Secrets in VS Code SecretStorage, no API keys in logs
- **Performance**: Stream updates without blocking UI
- **Reliability**: Auto-reconnect, graceful error handling

## 9. UX Overview

### Activity Bar
- OpenHands icon opens the OpenHands view container (chat lives in the sidebar)
- No separate “quick actions” view; actions are available in the chat header and via the command palette

### Chat View Layout
- **Header**: connection status, server selector, settings button, history button
- **Main**: message list with streaming events
- **Bottom**: input area with context picker (@), skills button, tools button (local)

### Flows
- First run: prompt to configure API key via commands or Settings
- Send message: stream events, show tool execution
- Confirmation: display pending action with Approve/Reject (or HAL overlay)

## 10. Extension Structure

```
src/
├── extension.ts                 # Entry point, commands
├── conversation/                # Conversation management
│   └── host/
│       └── ConversationManager.ts # Conversation state management
├── dev/                         # Development utilities
├── extension/                   # Extension utilities
├── hal/                         # HAL 9000 easter egg (high-risk confirmation flow)
│   ├── elevenlabs/              # ElevenLabs TTS integration
│   └── gemini/                  # Gemini audio understanding
├── settings/                    # Settings management
│   ├── host/                    # Host-side settings
│   ├── SettingsManager.ts       # Settings access layer
│   └── VscodeSettingsAdapter.ts # VS Code implementation
├── shared/                      # Shared types and utilities
├── sidebar/                     # Sidebar webview provider (host side)
│   └── OpenHandsChatViewProvider.ts # WebviewViewProvider that loads the React UI below
├── terminal/                    # Terminal integration
├── webview/host/                # Webview host integration (message passing)
└── webview-src/                 # React webview UI (actual view content)
    ├── webview.tsx              # React entry point
    ├── __tests__/               # Webview unit tests
    ├── shared/                  # Shared webview utilities
    └── components/
        ├── App.tsx              # Main component
        ├── EventBlock.tsx       # Event rendering
        ├── InputArea.tsx        # Chat input
        ├── HistoryView.tsx      # Conversation history
        ├── Header.tsx           # Chat header
        ├── StatusBanner.tsx     # Status banner
        ├── ToolbarButtons.tsx   # Toolbar buttons
        ├── ServerSelector.tsx   # Server selector
        └── ConfirmationPrompt.tsx
```

## 11. Packaging & Distribution
- Engine: VS Code >= 1.104.0
- Node: >= 22
- Extension ID: openhands.openhands-tab

### 11.1 What ships in the VSIX (and what doesn’t)
- The extension vendors the SDK code under `src/sdk`, `src/tools`, `src/workspace` and compiles it into `dist/`.
- There is no runtime dependency on `@openhands/agent-sdk-ts` via npm in the extension. Users do not need the npm package to use the VS Code extension.
- The separate `@openhands/agent-sdk-ts` publish is only for developers who want to import the SDK in their own projects.

Implication: You can publish a GitHub release with just the `.vsix` and it will work for users, even if the npm package has not been published.

### 11.2 Build and package the extension
```bash
# From repo root
npm ci
npm run compile                # build extension + webview
npm run package                # produces a .vsix under the repo root
```
Notes:
- `npm run package` wraps `vsce package` via `scripts/run-vsce-package.cjs` (adds a small CPU patch and follows symlinks).
- If you want a clean build: `git clean -fdx && npm ci && npm run compile`.

### 11.3 Validate the VSIX locally
```bash
# Install the built VSIX in your VS Code
code --install-extension openhands.openhands-tab-*.vsix
# Or via UI: Extensions panel → … menu → Install from VSIX…
```

### 11.4 GitHub Release (recommended)
1) Bump version in `package.json` and commit
```bash
npm version patch    # or minor/major
```
2) Build and package
```bash
npm run compile && npm run package
```
3) Create a Git tag and GitHub release, attach the `.vsix` file
- Tag suggestion: `v<version>` (e.g., `v0.5.1`)
- Release notes: include highlights and compatibility notes

Users can download the `.vsix` from the release and install directly (no Marketplace required).

### 11.5 VS Code Marketplace (optional)
Requirements:
- Publisher set to `openhands` (already in `package.json`).
- Logged in with `vsce` (PAT):
```bash
npx vsce login openhands
```
Publish:
```bash
npx vsce publish               # publishes the current version
# or
npx vsce publish patch         # bump + publish (minor/major also supported)
```

### 11.6 Releasing the SDK package (optional)
Only needed if you want others to `npm i @openhands/agent-sdk-ts` in their projects. It is NOT required for the VSIX to work.
```bash
# Preflight
npm ci
npm test -w @openhands/agent-sdk-ts
npm run lint -w @openhands/agent-sdk-ts
npm run build -w @openhands/agent-sdk-ts
# Optional: see tarball contents
npm pack -w @openhands/agent-sdk-ts --dry-run
# Version bump and publish
npm version patch -w @openhands/agent-sdk-ts
npm publish -w @openhands/agent-sdk-ts --access public
```

### 11.7 Troubleshooting
- If users install from GitHub release and see missing module errors for `@openhands/agent-sdk-ts`, it means the extension started depending on the npm package. Revert to vendoring under `src/sdk` or publish the package and add it to `dependencies`.
- Engine mismatch: ensure VS Code version >= `engines.vscode` and Node >= `engines.node`.
- To exclude source maps from the VSIX, add an `.npmignore` entry like `*.map` or adjust bundler settings.

## 12. Implementation Phases

### POC ✓ Complete
- Connect to server, create/restore conversation, send/stream messages
- Minimal chat UI, basic status, reconnect handling

### Settings ✓ Complete
- Server URL, LLM profiles, API key storage
- VS Code SecretStorage integration
- LLM Profiles view for profile management

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
- Skills and tools buttons

### Conversation History ✓ Complete
- History view with conversation list
- Title and prompt preview

### TODO: Future Enhancements
- **Attach Files (images/binary)** - richer attachment support beyond text + inline images
- **MCP Integration** - DEFERRED until further notice; requires explicit human approval to work on
- **Mid-Conversation Model Switch** - change LLM without new conversation
- **Advanced History** - export + richer metadata (and server-backed history if needed)

## 13. References
- [agent-sdk](https://github.com/OpenHands/software-agent-sdk) - Python SDK and agent-server
- [agent-sdk-architecture.md](agent-sdk-architecture.md) - SDK architecture
- [settings_prd.md](settings_prd.md) - Settings system details
