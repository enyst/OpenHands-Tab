# OpenHands Tab — WebviewPanel → WebviewView (Sidebar) Migration Plan

Goal: migrate the chat UI from an editor `WebviewPanel` to a sidebar `WebviewView` (while keeping the option to open in the editor if we want), without regressing local/remote mode, history restore, terminal streaming, or tests.

This plan is written for parallel execution by multiple agents (implementation + review + testing).

---

## 0) Current Behavior (baseline)

Today we have two separate UI surfaces:

1) **Sidebar container + tree view**
   - `package.json` contributes an activity bar container `openhands` with a tree view `openhands.quickActions`.
2) **Editor tab webview panel**
   - `openhands.openTab` creates a `WebviewPanel` (`src/extension.ts`) which hosts the React webview.

The “double open” happens because the extension currently auto-runs `openhands.openTab` whenever the sidebar tree view becomes visible:
- `src/extension.ts` registers a `TreeView` and `onDidChangeVisibility` calls `openhands.openTab`.

The chat runtime (Conversation + event wiring) is currently tightly coupled to `panel.webview`:
- `ensurePanelAndConnection()` creates the panel, creates/refreshes the Conversation, and forwards Conversation events/status/errors to `panel.webview.postMessage(...)`.
- `onWebviewMessage(context, panel)` assumes a `WebviewPanel` and posts all replies back through `panel.webview.postMessage(...)`.

---

## 1) Desired End-State (UX)

We need to decide what “clicking the OpenHands icon” should do, and where the chat UI should live.

Recommended UX (min confusion / no double-open):
- **Default:** chat UI opens in the **sidebar** as a `WebviewView`.
- **Optional:** a command allows opening the same UI in the **editor** as a `WebviewPanel` (useful for larger screen / multi-monitor).
- The sidebar tree view (“quick actions”) can remain (or be removed later), but it should not automatically open a second UI surface.

### Note: Webview placement constraints (Active vs Beside)

- A `WebviewPanel` always lives in the **editor area** (editor groups/columns). `ViewColumn.Active` opens in the currently active editor group; `ViewColumn.Beside` opens in a new group to the side (roughly “split editor and put it next to what you’re doing”).
- A `WebviewView` always lives in a **contributed view container** (sidebar/panel). There is no `ViewColumn` equivalent; you can show/hide the view, but it will not become an editor tab.

We can support this with:
- A setting: `openhands.ui.location = "sidebar" | "editor"` (default `"sidebar"`).
- Commands:
  - `OpenHands: Open` (respects setting)
  - `OpenHands: Open in Sidebar`
  - `OpenHands: Open in Editor`

Decision needed before Phase 3:
- Keep `openhands.quickActions` tree view long-term, or replace it with the webview view?

---

## 2) Key Lifecycle Differences (and what “parity” means)

### “Behavior parity” definition

For this migration, “parity” means: regardless of whether the UI is hosted as a sidebar `WebviewView` or editor `WebviewPanel`, users can still:
- send messages and see streaming responses
- see tool execution events (terminal, file edits, etc.)
- see and act on pending actions (approvals/rejections)
- restore/start conversations and use history UI
- see connection/status/config updates and errors

Non-parity differences we accept (by design):
- **where** the UI appears (sidebar vs editor)
- whether we allow both surfaces simultaneously (decision in Open Questions)

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
- Have the webview send `webviewReady` with optional fields:
  - `conversationId?: string`
  - `lastSeenSeq?: number`
  (Persist these in the webview via `acquireVsCodeApi().setState(...)`.)
- Extension responds on ready/visibility:
  - always send `status` + `serverListUpdated`
  - if `conversationId` mismatches or `lastSeenSeq` is missing/out of range: send `conversationStarted` + the full buffer
  - else: send only buffered events with `seq > lastSeenSeq`

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

### Phase 2 — Decouple UI wiring from WebviewPanel (introduce a WebviewHost)
**Goal:** Make the Conversation <-> UI message bridge work with either a panel or a view.

Key refactor:
- Introduce a minimal `WebviewHost` abstraction:
  - `webview: vscode.Webview`
  - `show(preserveFocus?: boolean): void` (panel.reveal() vs view.show())
  - optional: `onDidDispose` handler
  - optional: `visible` (view has it; panel has `visible`)

Refactor steps:
- Replace global `panel` with `uiHost?: WebviewHost`.
- Rename `ensurePanelAndConnection()` → `ensureUiHostAndConnection(target: 'panel' | 'view' | 'auto')`.
- Replace direct `panel.webview.postMessage(...)` with `postToWebview(...)` helper.
- Refactor `onWebviewMessage(context, panel)` to accept `(context, host)` or `(context, webview, postFn)`.

Event delivery resilience (required for WebviewView):
- Add an **event backlog buffer** in the extension host (ring buffer, e.g. last 500–2000 events) with a monotonic `seq` id.
  - Exclude noisy stream deltas if needed (`ConversationStateUpdateEvent` with `key` `llm_stream` / `llm_tool_call`) to keep it readable and small.
- On `webviewReady` and on `WebviewView` visibility changes, post:
  - `status`
  - `serverListUpdated`
  - “catch-up” events using the `lastSeenSeq` protocol above

Acceptance criteria:
- Both the existing editor panel and the new sidebar view can:
  - send messages
  - receive event stream
  - render status/config

Suggested PR boundary:
- “Refactor message bridge to support WebviewView”.

---

### Phase 3 — Remove “double open” and add the user-facing choice
**Goal:** Clicking the OpenHands icon no longer opens two surfaces; user controls where chat opens.

Tasks:
- Add setting `openhands.ui.location` with enum:
  - `"sidebar"` (default)
  - `"editor"`
- Commands:
  - Update `openhands.openTab` to behave like `OpenHands: Open` (respects setting)
  - Add explicit commands:
    - `openhands.openInSidebar`
    - `openhands.openInEditor`
- Change the current auto-open behavior:
  - Remove `treeView.onDidChangeVisibility -> openTab`, OR gate it behind a setting (default off).
  - If the tree view remains, it should be “quick actions only”, not a trigger for opening a second UI.

Acceptance criteria:
- Clicking the activity bar icon opens the container; **only one** chat surface appears by default.
- The other surface is accessible via explicit command.

Suggested PR boundary:
- “Sidebar chat is default; stop auto-opening editor tab”.

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
- **Workstream A (Extension API + contributions):** `package.json` views/activation/settings/commands.
- **Workstream B (Bridge refactor):** `WebviewHost` abstraction + refactor `ensurePanelAndConnection` + `onWebviewMessage`.
- **Workstream C (Backlog + lifecycle):** webviewReady rehydration + hidden/visible message strategy.
- **Workstream D (Tests + QA):** unit test updates + manual verification notes.

Try to keep PRs small and sequential:
1) Phase 1
2) Phase 2
3) Phase 3
4) Phase 4 follow-ups

---

## 5) Open Questions (capture before coding Phase 3)

1) Do we keep the sidebar tree view long-term, or replace it entirely with the webview view?
2) Do we support “both” simultaneously (sidebar + editor), or is it always one-at-a-time?
3) What is the default: sidebar or editor?
4) Should the editor tab be opened “Beside” or in the active group when using the editor mode?
