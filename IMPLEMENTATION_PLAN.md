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

2) Add this implementation plan and reference it from PRD
- File: IMPLEMENTATION_PLAN.md (this file)
- Update prd.md to link to this plan
- Commit message:
  "docs: add @openhands/ui integration plan
  
  - Create IMPLEMENTATION_PLAN.md
  - Link it from prd.md"

Unit tests: N/A (docs only)

## Phase 1 — Test Infrastructure (Vitest + React Testing Library)
Goal: Add a fast unit test setup usable for pure TS and React components.

Changes:
- Add devDependencies: vitest, @vitest/coverage-v8, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, @types/jsdom
- Add scripts to package.json:
  - "test": "vitest run"
  - "test:watch": "vitest"
  - "typecheck": "tsc -p . && tsc -p tsconfig.webview.json"
- Create vitest.config.ts (jsdom environment for webview tests)
- Create test/setup.ts importing @testing-library/jest-dom

Initial tests:
- src/types/__tests__/agent-sdk.guards.test.ts
  - Validate isEvent, isMessageEvent, isTextContent against minimal valid/invalid samples.

Run:
- npm run test
- npm run typecheck

Commit message:
"test: add vitest + RTL and initial guard tests

- Configure vitest (jsdom)
- Add tests for agent-sdk type guards
- Add test scripts"

## Phase 2 — Webview React Bootstrap + @openhands/ui
Goal: Convert the webview to React and adopt base UI components.

Changes:
- Install runtime deps: react@^19, react-dom@^19, @openhands/ui
- Add bundler: esbuild (as devDependency) with a build:webview script that bundles src/webview-src/webview.tsx to media/webview.js
- Convert src/webview-src/webview.ts → webview.tsx and implement a minimal React <App />
  - Header: Typography.H1 title, basic status dot
  - Main: <Scrollable> messages container
  - Footer: textarea + <Button> Send and Stop
- Import styles: import "@openhands/ui/styles" in webview.tsx
- Ensure CSS is emitted to media/webview.css (either via esbuild CSS loader or by copying dist/index.css from the package as a build step)
- Ensure extension injects media/webview.css into the webview HTML

Tests:
- src/webview-src/__tests__/App.render.test.tsx
  - Renders <App /> and asserts header, input, and buttons exist

Run:
- npm run test
- npm run typecheck

Commit message:
"feat(webview): bootstrap React + @openhands/ui base shell

- Add React and @openhands/ui
- Bundle webview with esbuild
- Import @openhands/ui/styles
- Minimal App shell with Typography, Button, Scrollable
- Add rendering test"

## Phase 3 — Typed Event Rendering
Goal: Bridge VS Code messages into React state using agent-sdk types/guards and render events.

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
Goal: Hook Send/Stop/Settings actions and add ToastManager for errors.

Changes:
- Wire Send to vscode.postMessage({ type: 'send', text })
- Wire Stop to vscode.postMessage({ type: 'command', command: 'pause' })
- Wire Settings to vscode.postMessage({ type: 'openSettings' })
- Add <ToastManager /> at the root and show toasts for errors/status changes

Tests:
- src/webview-src/__tests__/ActionsAndToasts.test.tsx
  - Mock vscode.postMessage and assert calls on button clicks
  - Simulate error event and assert toast appears

Run:
- npm run test
- npm run typecheck

Commit message:
"feat(webview): actions (send/stop/settings) and toasts

- Hook buttons to postMessage
- Add ToastManager for error/status
- Add unit tests for actions and toasts"

## Phase 5 — Compile and Manual Verification
Goal: Build all artifacts, run type-checks, and do a manual smoke test in VS Code.

Run:
- npm run compile (includes extension + webview)
- npm run test
- npm run typecheck

Commit message:
"chore: compile and finalize @openhands/ui integration

- Ensure compile and tests pass
- Minor polish from manual verification"

## Notes
- Fonts/CSP: Keep CSP strict; rely on fallback fonts. Optionally localize fonts later.
- Future: Introduce richer components (Select, Tabs, Tooltip, Dialog) and additional tests.
- CI: Optional to add a GitHub Actions workflow to run test and typecheck on PRs.
