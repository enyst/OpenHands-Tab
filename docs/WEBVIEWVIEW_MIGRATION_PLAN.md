# OpenHands Tab — WebviewPanel → WebviewView (Sidebar) Migration Plan

Goal: migrate the chat UI from an editor `WebviewPanel` to a sidebar `WebviewView` (sidebar-only), without regressing local/remote mode, history restore, terminal streaming, or tests.

Status: COMPLETED in PR #200 (commit `a987ed9`).

Decision (locked in):
- The chat UI will live only in the sidebar as a `WebviewView`.
- The editor `WebviewPanel` implementation will be removed (no user-facing “open in editor” option).
- Remove the sidebar tree view `openhands.quickActions` (no separate “quick actions” view).
- Replace `openhands.openTab` with a clean command id (e.g. `openhands.open`) and delete `openhands.openTab` (no legacy alias).

This plan is written for parallel execution by multiple agents (implementation + review + testing).

Related docs:
- `docs/IMPLEMENTATION_PLAN.md` (webview build-out status + next milestones)
- `docs/PRD.md` (requirements + feature status)
- `docs/vscode_local_setup.md` (local dev + webview debugging tips)

---

## 0) Pre-migration baseline (historical)

Before the migration (pre-#200), we had two separate UI surfaces:

1) **Sidebar container + tree view**
   - `package.json` contributes an activity bar container `openhands` with a tree view `openhands.quickActions`.
2) **Editor tab webview panel**
   - `openhands.openTab` creates a `WebviewPanel` (`src/extension.ts`) which hosts the React webview.

The “double open” happened because the extension auto-ran `openhands.openTab` whenever the sidebar tree view became visible:
- `src/extension.ts` registers a `TreeView` and `onDidChangeVisibility` calls `openhands.openTab`.

The chat runtime (Conversation + event wiring) was tightly coupled to `panel.webview`:
- `ensurePanelAndConnection()` creates the panel, creates/refreshes the Conversation, and forwards Conversation events/status/errors to `panel.webview.postMessage(...)`.
- `onWebviewMessage(context, panel)` assumes a `WebviewPanel` and posts all replies back through `panel.webview.postMessage(...)`.

The webview sent a `webviewReady` handshake. The extension host responded by re-sending `status` and `serverListUpdated`. This was sufficient for a panel, but not enough for a `WebviewView` that can be hidden/disposed while the agent continues running.

---

## 1) Desired End-State (UX)

What “clicking the OpenHands icon” should do is now straightforward: it should reveal the OpenHands view container and the chat `WebviewView`.

End-state UX (no double-open, no editor tab):
- Chat UI is a single sidebar `WebviewView` (e.g. `openhands.chat`).
- The OpenHands view container contains only the chat view; any “quick actions” should move into the chat header (or live only in the command palette).

### Notes: `WebviewView` constraints

- A `WebviewView` lives in a contributed view container (sidebar). There is no `ViewColumn` equivalent.
- The extension should provide one “open” command whose job is to focus/reveal the view (and nothing else).

Recommended command surface:
- `OpenHands: Open` (command id `openhands.open`) reveals the OpenHands view container and focuses `openhands.chat`.
- `openhands.openTab` is removed as part of the migration (clean command surface; no alias).

---

## 2) Key Lifecycle Differences (and what “parity” means)

### “Behavior parity” definition

For this migration, “parity” means: after moving the UI into the sidebar `WebviewView`, users can still:
- send messages and see streaming responses
- see tool execution events (terminal, file edits, etc.)
- see and act on pending actions (approvals/rejections)
- restore/start conversations and use history UI
- see connection/status/config updates and errors

Non-parity differences we accept (by design):
- No editor-hosted chat UI (the chat lives in the sidebar only)

### Why `WebviewView` is not a drop-in replacement

Even with `retainContextWhenHidden`, `WebviewView` differs in lifecycle:
- It is only created/resolved when the view becomes visible (`resolveWebviewView` is lazy).
- It can be disposed by the user (removing/hiding the view), requiring a fresh resolve later.
- **You cannot rely on message delivery while it is hidden.** (Messages may be dropped when the view is not visible.)

So we need a robust “rehydration” path:
- When the view becomes visible or the webview signals `webviewReady`, re-send:
  - current status (`online/offline/connecting`)
  - current config (serverUrl/mode/server list)
  - recent event backlog (or at least enough to catch up)

#### Recommended catch-up protocol (prevents duplication)

To avoid duplicating events when the webview is retained (or missing events when it wasn’t), use a simple sequence protocol:
- In the extension host, assign a monotonic `seq` to each forwarded Conversation event and store the last N in a ring buffer (include the current `conversationId`).
- Extend the existing `webviewReady` handshake to optionally include:
  - `conversationId?: string`
  - `lastSeenSeq?: number`
  (Persist these in the webview via `acquireVsCodeApi().setState(...)`.)
- Extension responds on ready/visibility:
  - always send `status` + `serverListUpdated`
  - if `conversationId` mismatches or `lastSeenSeq` is missing/out of range: send `conversationStarted` + the full buffer
  - else: send only buffered events with `seq > lastSeenSeq`

Implementation notes:
- Treat `webviewReady` as idempotent (it may fire more than once per render lifecycle today).
- Decide which `ConversationStateUpdateEvent`s to buffer:
  - buffer `agent_status` updates (needed to rehydrate confirmation/pause UI)
  - consider dropping `llm_stream` / `llm_tool_call` deltas from the backlog (noisy); users will still see the final `MessageEvent`/tool events when the view is shown again

This is the main “state restore nuance” required to achieve parity with `WebviewPanel` behavior.

---

## 3) Implementation Plan (phased)

### Phase 1 — Add a WebviewView host (no UX change yet)
**Goal:** Introduce a sidebar webview view and prove it can render the existing UI.

Tasks:
- `package.json`
  - Add a new contributed view in the `openhands` container:
    - `id`: `openhands.chat`
    - `type`: `webview`
  - Add activation event: `onView:openhands.chat`
- Extension host
  - Register `vscode.window.registerWebviewViewProvider('openhands.chat', provider, { webviewOptions: { retainContextWhenHidden: true } })`
  - Provider `resolveWebviewView(webviewView, ...)` sets:
    - `webviewView.webview.options = { enableScripts: true, localResourceRoots: [...] }`
    - `webviewView.webview.html = getWebviewHtml(...)`
    - `webviewView.webview.onDidReceiveMessage(...)` wiring

Deliverable:
- We can manually open the sidebar view and see the React UI, even if actions are not fully wired yet.

Suggested PR boundary:
- “Add sidebar chat view scaffold” (no behavior changes).

---

### Phase 2 — Refactor the message bridge for `WebviewView` lifecycle
**Goal:** Make the Conversation <-> UI message bridge robust for a sidebar `WebviewView` (hidden/disposed/re-resolved) and remove hard coupling to `panel.webview`.

Key refactor:
- Replace `panel`-centric wiring with a `WebviewView`-centric host:
  - store the latest `vscode.WebviewView` reference (or just its `webview`)
  - centralize `postMessage(...)` behind a single helper that no-ops when the view is absent

Refactor steps:
- Introduce `ensureChatViewAndConnection()` (or similar) that ensures the Conversation exists and the sidebar view is ready to receive messages.
- Update `onWebviewMessage(...)` to take `webview: vscode.Webview` (not a `WebviewPanel`) and reuse it for both panel-less message handling and tests.

Event delivery resilience (required for WebviewView):
- Add an **event backlog buffer** in the extension host (ring buffer, e.g. last 500–2000 events) with a monotonic `seq` id.
  - Exclude noisy stream deltas if needed (`ConversationStateUpdateEvent` with `key` `llm_stream` / `llm_tool_call`) to keep it readable and small.
- On `webviewReady` and on `WebviewView` visibility changes, post:
  - `status`
  - `serverListUpdated`
  - “catch-up” events using the `lastSeenSeq` protocol above

Acceptance criteria:
- The sidebar chat view can send messages, receive the event stream, and rehydrate after being hidden/disposed.

Suggested PR boundary:
- “Refactor message bridge for WebviewView”.

---

### Phase 3 — Remove editor `WebviewPanel` and stop “double open”
**Goal:** There is exactly one chat UI surface: the sidebar `WebviewView`.

Tasks:
- Commands / contributions (cleanliness goal):
  - Add `openhands.open` (“OpenHands: Open”) to reveal/focus the sidebar chat view.
  - Delete `openhands.openTab` (breaking change; update docs/tests accordingly).
- Remove editor tab creation:
  - Delete `vscode.window.createWebviewPanel(...)` usage and `panel` module state.
  - Remove any editor-tab-only code paths (including tests that assume a panel exists).
- Change the current auto-open behavior:
  - Remove `treeView.onDidChangeVisibility -> openTab`.
  - Remove the `openhands.quickActions` tree view contribution and its `OpenHandsViewProvider` scaffolding.

Acceptance criteria:
- Clicking the activity bar icon opens the container; the chat UI is in the sidebar view and no editor tab is created.

Suggested PR boundary:
- “Sidebar chat only; remove editor panel”.

---

### Phase 4 — Tests and QA (must-do)
**Goal:** prevent regressions and ensure WebviewView behaviors are correct.

Unit tests (Vitest):
- Extend `src/__tests__/extension.test.ts` to cover:
  - WebviewView provider registration + resolve path
  - `webviewReady` triggers initial status/config post
  - backlog flushing sends events after re-open / re-ready
  - switching modes (serverUrl empty vs set) does not throw

Manual QA checklist (Extension Development Host):
- Sidebar chat view opens and renders.
- Local mode:
  - send a message
  - terminal events appear in both webview and terminal log
- Remote mode:
  - set `openhands.serverUrl`
  - reconnect works
- Hide/collapse sidebar view while agent runs:
  - when expanded again, UI catches up (status + backlog).
- Disposing the view (hide via view menu) and re-adding it:
  - extension should handle re-resolve without stale references.

---

## 4) Suggested Parallel Workstream Breakdown (multi-agent)

If we want to parallelize safely:
- **Extension API + contributions:** `package.json` views/activation/settings/commands.
- **Bridge refactor:** refactor `ensurePanelAndConnection` + `onWebviewMessage` toward a view-only bridge.
- **Backlog + lifecycle:** webviewReady rehydration + hidden/visible message strategy.
- **Tests + QA:** unit test updates + manual verification notes.

Try to keep PRs small and sequential:
1) Phase 1
2) Phase 2
3) Phase 3
4) Phase 4 follow-ups

---

## 5) Open Questions

1) When a user runs `OpenHands: Open`, should it also auto-focus the chat view (vs. just reveal the container)?
