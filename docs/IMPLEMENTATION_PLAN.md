# OpenHands-Tab — Webview Implementation Plan (React UI + typed agent-sdk events)

This document tracks the implementation of the React webview UI and the extension host ↔ webview message bridge. Phases 1–6 reflect the initial build-out (now completed). New phases at the end track ongoing webview work (notably the `WebviewPanel` → `WebviewView` migration and remaining UX gaps).

Guiding principles:
- Source of truth: agent-sdk models and wire formats.
- No Zod; use lightweight type guards.
- Use React in the VS Code webview.
- Don’t optimize for bundle size during implementation.
- Keep changes small and land them when unit tests pass.

Related docs:
- `docs/PRD.md` (requirements + feature status)
- `docs/WEBVIEWVIEW_MIGRATION_PLAN.md` (sidebar `WebviewView` migration plan)
- `docs/vscode_local_setup.md` (local dev + webview debugging tips)

## Phase 0 — Baseline
- Install deps: `npm ci`
- Validate: `npm test`, `npm run typecheck`, `npm run build:webview`

## Phase 1 — Test Infrastructure (Vitest + React Testing Library)
Goal: Add a fast unit test setup usable for pure TS and React components.

Status: COMPLETED

Changes done:
- Added devDependencies: vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom/vitest, jsdom, esbuild
- Added scripts to package.json:
  - `test`: `npm test -w @openhands/agent-sdk-ts && vitest run --dir src`
  - `test:watch`: `vitest`
  - `typecheck`: `tsc -p . && tsc -p tsconfig.webview.json`
- Created vitest.config.ts (jsdom environment)
- Created test/setup.ts importing @testing-library/jest-dom/vitest

Initial tests implemented:
- `packages/agent-sdk-ts/src/sdk/__tests__/agent-sdk.guards.test.ts`
  - Validates core guard behavior (e.g., `isEvent`, `isMessageEvent`) with minimal valid/invalid samples.

Run:
- npm run test (passing)
- npm run typecheck (passing)

## Phase 2 — Webview React Bootstrap + @openhands/ui
Goal: Convert the webview to React and adopt base UI components.

Status: COMPLETED

Changes done:
- Installed runtime deps: react@^19, react-dom@^19
- Installed @openhands/ui and imported its styles via `src/webview-src/index.css`
- Added esbuild with `build:webview`; bundles `src/webview-src/webview.tsx` → `media/webview.js` and CSS → `media/index.css`
- Updated extension HTML to mount React app at #app
- Implemented React `<App />` shell (header, event list, input area)
- Added basic App render test with RTL; vitest excludes built `media/**`

Run:
- npm run build:webview (succeeds)
- npm run test (passing)
- npm run typecheck (passing)

## Phase 3 — Typed Event Rendering
Goal: Bridge VS Code messages into React state using agent-sdk types/guards and render events.

Status: COMPLETED

Changes done:
- Webview validates incoming `{ type: 'event' }` payloads with agent-sdk type guards
- Event rendering is componentized by event kind (message/action/observation/system prompt/errors/etc.)
- Streaming UX uses the `ConversationStateUpdateEvent` deltas (via `reduceLlmStreamingState`) without rendering those events as standalone blocks
- Added tests:
  - `src/webview-src/__tests__/event.handlers.test.tsx`
  - `src/webview-src/__tests__/event.rendering.test.tsx`

Run:
- npm run test (passing)
- npm run typecheck (passing)
- npm run build:webview (succeeds)

## Phase 4 — Commands and Status UI
Goal: Wire webview commands (send, pause/resume, reconnect, new chat, settings, history, skills, context) and show transient status/error UI.

Status: COMPLETED

Changes done:
- Webview → extension messages cover:
  - chat: `send`
  - control: `command` (`startNewConversation`, `reconnect`, `approveAction`, `rejectAction`; `pause`/`resume` supported for future UI)
  - UX helpers: workspace file list (context picker), skills list/open, history list/restore, server selection
- Header actions include New, History, Settings, and Reconnect
- Status/error UX uses an in-webview `StatusBanner` (auto-dismiss for non-errors)

## Phase 5 — Compile and Manual Verification
Goal: Build all artifacts, run type-checks, and do a manual smoke test in VS Code.

Status: COMPLETED

Automated:
- npm run compile (ok)
- npm run test (all green)
- npm run build:webview (ok)

Manual verification completed:
- Extension loads in VS Code (F5) and webview opens
- Status UI updates on connect/disconnect (header indicator + transient status banner)
- Messages send and appear correctly in the UI
- New conversation + reconnect flows work
- Errors surface via the status banner and render appropriately in the event stream

Implementation notes:
- media/webview.js and index.css generated via build process
- All styling uses Tailwind CSS 4.x (compiled to tailwind.gen.css, bundled to media/index.css)
- Webview uses React 19 with @openhands/ui components
- Backend prerequisite: OpenHands Agent Server (V1) from All-Hands-AI/agent-sdk. See README.md for uv quickstart. Default base http://localhost:3000. Configure via Settings button or openhands.serverUrl.

- TODO: Consider removing media/*.map from git if source maps are not needed in repo


## Phase 6 — VS Code Runtime Setup and Visual Validation
Goal: Provide one-command local dev via code-server and visually verify UI actions.

Status: COMPLETED

Implementation:
- Added scripts/dev-vscode.sh: builds webview, compiles, packages .vsix, installs to code-server, runs at 0.0.0.0:12000
- Added npm script dev:vscode to invoke the script
- Manual test steps verified:
  1) OpenHands UI opens; Connecting/Connected status is visible in the UI
  2) Send message; user message appears and extension receives it
  3) New, Reconnect, History, Settings work; status banner updates and extension receives commands
  4) System/error conditions surface via status banner and render correctly

Completed features:
- Full event visualization including MessageEvent, ActionEvent, ObservationEvent, SystemPromptEvent, AgentErrorEvent, PauseEvent, Condensation
- In-webview status banner for status changes and errors
- React-based UI with @openhands/ui components
- Tailwind CSS 4.x styling
- Type-safe event handling with agent-sdk type guards

## Phase 7 — WebviewPanel → WebviewView (Sidebar) Migration
Goal: Make the chat UI live in the sidebar as a `WebviewView` (sidebar-only) and remove the editor `WebviewPanel`.

Status: COMPLETED

Plan: `docs/WEBVIEWVIEW_MIGRATION_PLAN.md`

Implementation:
- Chat UI moved to a sidebar `WebviewView` (`openhands.chat`)
- Removed editor `WebviewPanel` and legacy `openhands.openTab` / quick-actions view
- Added event backlog + `webviewReady` catch-up for hide/show lifecycle
- Updated unit + e2e tests and docs for the new command surface

## Phase 8 — Remaining Webview UX Gaps (from PRD)
Goal: Close the remaining “Not Yet Implemented” items and polish the webview UX without regressing local/remote parity.

Status: TODO

Backlog (webview-facing):
- Attach files UX (the “+” affordance currently isn’t backed by a concrete flow)
- MCP server selection UI (if/when MCP integration lands)
- History UX improvements (search/pagination/empty states, depending on backend shape)
- Mid-conversation LLM switching UX (may require conversation boundary semantics)

## Notes
- Fonts/CSP: Keep CSP strict; rely on fallback fonts. Optionally localize fonts later.
- Future: Introduce richer components (Select, Tabs, Tooltip, Dialog) and additional tests.
- CI: Optional to add a GitHub Actions workflow to run test and typecheck on PRs.
