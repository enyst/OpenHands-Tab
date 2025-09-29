# OpenHands-Tab — @openhands/ui Integration and Typed Models Plan (with Unit Tests)

This plan executes selective integration of @openhands/ui and completes the TypeScript model alignment with agent-sdk. We include unit tests at every step and run them as we go.

Guiding principles:
- Source of truth: agent-sdk models and wire formats.
- No Zod; use lightweight type guards.
- Use React in the VS Code webview.
- Don’t optimize for bundle size during implementation.
- Commit each task to the develop branch when unit tests pass.

## Phase 0 — Baseline and Branching
1) Ensure we’re on the develop branch and working from a clean tree
- Commands:
  - git fetch --all
  - git checkout develop
  - git pull --rebase
- If a feature branch exists, we may cherry-pick as needed later.

2) Read this implementation plan and reference it from PRD
- File: IMPLEMENTATION_PLAN.md (this file)

## Phase 1 — Test Infrastructure (Vitest + React Testing Library)
Goal: Add a fast unit test setup usable for pure TS and React components.

Status: COMPLETED

Changes done:
- Added devDependencies: vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom/vitest, jsdom, esbuild
- Added scripts to package.json:
  - "test": "vitest run"
  - "test:watch": "vitest"
  - "typecheck": "tsc -p . && tsc -p tsconfig.webview.json"
- Created vitest.config.ts (jsdom environment)
- Created test/setup.ts importing @testing-library/jest-dom/vitest

Initial tests implemented:
- src/types/__tests__/agent-sdk.guards.test.ts
  - Validates isEvent, isMessageEvent, isTextContent for minimal valid/invalid samples.

Run:
- npm run test (passing)
- npm run typecheck (passing)

Commit message used:
"test: add vitest + initial guard tests

- Configure vitest with jsdom and setup file
- Add initial type guard tests for agent-sdk
- Add test/typecheck scripts and dev deps"

## Phase 2 — Webview React Bootstrap + @openhands/ui
Goal: Convert the webview to React and adopt base UI components.

Status: COMPLETED

Changes done:
- Installed runtime deps: react@^19, react-dom@^19
- Installed @openhands/ui and imported its styles in the webview App
- Added esbuild with build:webview script; bundling src/webview-src/webview.tsx to media/webview.js
- Updated extension HTML to mount React app at #app
- Implemented React <App /> (header, messages, footer with Send/Stop)
- Added basic App render test with RTL; configured vitest to ignore built media/** tests

Run:
- npm run build:webview (succeeds)
- npm run test (passing)
- npm run typecheck (passing)

Commit messages used:
"feat(webview): bootstrap React shell and esbuild bundle"
"build(webview): generate media/webview.js via esbuild"
"feat(ui): add @openhands/ui and React type packages"
"feat(webview): adopt @openhands/ui styles and factor App component"
"test(config): exclude built media/ from vitest; fix webview tsconfig for JSX/tests"

## Phase 3 — Typed Event Rendering
Goal: Bridge VS Code messages into React state using agent-sdk types/guards and render events.

Status: COMPLETED

Changes done:
- App uses agent-sdk guards to validate events from VS Code messages
- Message events render text content with role mapping
- System/error events rendered to system stream; other events noted as tool
- Added tests: src/webview-src/__tests__/event.rendering.test.tsx

Run:
- npm run test (passing)
- npm run typecheck (passing)
- npm run build:webview (succeeds)

Changes:
- In webview.tsx, add window message bridge useEffect
- Use src/types/agent-sdk.ts guards (isEvent, isMessageEvent, etc.) to parse events
- MessageEvent: push user/assistant messages into messages state
- Action/Observation/System/Error events: push a tool-style message with a compact header and body

Tests:
- src/webview-src/__tests__/EventBridge.test.tsx
  - Simulate postMessage events (MessageEvent and ActionEvent) and assert rendered output updates

Run:
- npm run test
- npm run typecheck

Commit message:
"feat(webview): typed event bridge and rendering

- Use agent-sdk guards to validate events
- Render message and tool events in React
- Add unit tests for event handling"

## Phase 4 — Commands and Toasts
Goal: Wire webview commands (send, stop, reconnect, new chat, settings) and show toasts on status + system/error.

Status: COMPLETED

So far:
- Added ToastManager and toasterMessages usage
- Toasts on status transitions and config updates
- Toasts on system and error events
- Switched header buttons to @openhands/ui Button and Typography
- Added non-asserting toast runtime test

Next:
- Add Reconnect and New Chat buttons in UI, postMessage commands
- Optional: show success toast on command initiation
- Quick tests to ensure no runtime errors


## Phase 5 — Compile and Manual Verification
Goal: Build all artifacts, run type-checks, and do a manual smoke test in VS Code.

Status: IN PROGRESS

Automated:
- npm run compile (ok)
- npm run test (all green)
- npm run build:webview (ok)

Manual verification steps (to do in VS Code):
- Load extension in VS Code (F5) and open the webview
- Observe status toast when connecting and when online
- Send a message; verify it appears and extension receives it
- Trigger Stop, Reconnect, New Chat; verify extension receives commands
- Simulate system and error events; toasts appear and messages rendered

Notes:
- media/webview.js and webview.css generated; source maps exist and are currently tracked
- Optional: remove media/*.map from git if undesired


## Phase 6 — VS Code Runtime Setup and Visual Validation
Goal: Provide one-command local dev via code-server and visually verify UI actions.

Plan:
- Add scripts/dev-vscode.sh: builds webview, compiles, packages .vsix, installs to code-server, runs at 0.0.0.0:12000
- Add npm script dev:vscode to invoke the script
- Manual test steps (with screenshots):
  1) Open the extension tab; confirm Connecting and Connected toasts
  2) Send message; see user message and extension receives it
  3) Stop, Reconnect, New Chat buttons; verify toasts and extension receives commands
  4) Post simulated system/error events; verify toasts and rendering
- Capture screenshots and attach for verification

Status: IN PROGRESS


## Notes
- Fonts/CSP: Keep CSP strict; rely on fallback fonts. Optionally localize fonts later.
- Future: Introduce richer components (Select, Tabs, Tooltip, Dialog) and additional tests.
- CI: Optional to add a GitHub Actions workflow to run test and typecheck on PRs.
