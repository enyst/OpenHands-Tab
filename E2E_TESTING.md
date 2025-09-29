# End-to-End (E2E) Testing Guide
[Updated] Automated E2E scaffolding has been added under tests/e2e. See package.json scripts for `npm run e2e`.



This document explains practical ways to run E2E tests for the OpenHands-Tab VS Code extension. It focuses on verifying the full loop: the extension UI (webview) ↔ extension host ↔ agent-server.

Scope
- Smoke tests: extension activates, commands are registered, webview opens and renders
- Interaction: send a user message and observe streamed events from an agent-server
- Environment options: local desktop, or headless desktop via Xvfb+noVNC in CI/sandboxes

Prerequisites
- Node.js 22+
- VS Code Desktop (Electron build)
- Optional: Python 3.12+ and agent-server (agent-sdk) running
- Recommended default server URL: http://localhost:3000

Option A — Local Manual E2E (fastest way to validate)
1) Install and build the extension
   - npm install
   - npm run compile
2) Start agent-server (separate terminal)
   - git clone https://github.com/All-Hands-AI/agent-sdk && cd agent-sdk
   - `uv run python -m openhands.agent_server --host 0.0.0.0 --port 3000`
3) Launch the extension in VS Code
   - Open this folder in VS Code
   - Press F5 to run “Extension Development Host”
4) In the Dev Host window
   - Run “OpenHands: Configure” → ensure server URL is http://localhost:3000
   - Run “OpenHands: Open Tab”
   - Run “OpenHands: Start New Conversation”
   - Type a message and verify assistant/tool events stream in the tab

Option B — Headless Desktop in a Sandbox (Xvfb + x11vnc + noVNC)
Use this when a GUI is not available but the environment exposes web ports (e.g., CI runners or the provided work-1/work-2 hosts).

1) Install packages (Ubuntu example)
   - apt-get update
   - apt-get install -y xvfb x11vnc novnc websockify fluxbox imagemagick wget ca-certificates
   - wget -O /tmp/code.deb "https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64"
   - apt-get install -y /tmp/code.deb
2) Set a VNC password
   - mkdir -p ~/.vnc
   - x11vnc -storepasswd "$(openssl rand -base64 24)" ~/.vnc/passwd
3) Start services (example display :1)
   - export DISPLAY=:1
   - Xvfb :1 -screen 0 1280x800x24 -nolisten tcp > /tmp/xvfb.log 2>&1 & echo $! > /tmp/xvfb.pid
   - fluxbox -display :1 > /tmp/fluxbox.log 2>&1 & echo $! > /tmp/wm.pid
   - x11vnc -display :1 -rfbport 5901 -forever -shared -rfbauth ~/.vnc/passwd -noxdamage -repeat -bg -o /tmp/x11vnc.log
   - websockify --web /usr/share/novnc --heartbeat 30 12000 localhost:5901 > /tmp/novnc.log 2>&1 & echo $! > /tmp/novnc.pid
4) Build the extension
   - npm ci || npm install
   - npm run compile
5) Launch VS Code on the virtual display
   - code --user-data-dir=/tmp/vscode-profile \
       --extensions-dir=/tmp/vscode-extensions \
       --no-sandbox --disable-gpu \
       --extensionDevelopmentPath=$(pwd) \
       > /tmp/code.log 2>&1 & echo $! > /tmp/code.pid
6) Access the desktop via browser
   - Navigate to the mapped host for port 12000, for example:
     - https://work-1-<your-suffix>.prod-runtime.all-hands.dev/vnc.html?autoconnect=true
   - Authenticate with the VNC password; you should see Fluxbox and VS Code
   - Run the extension commands as in Option A
7) Capture an artifact (optional)
   - xwd -display :1 -root | convert xwd:- ./e2e-shot.png

Option C — Automated E2E (integration tests) with @vscode/test-electron
This option programmatically launches VS Code with the extension under test and runs Mocha tests. It is suitable for CI once stabilized. Webview DOM assertions are possible but require bridging or using VS Code APIs to read webview HTML.

Suggested setup (outline)
- Add devDependencies: @vscode/test-electron, mocha, ts-node, typescript
- Create test/e2e/openTab.test.ts:

  import * as assert from 'assert';
  import { runTests, downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
  import * as cp from 'child_process';
  import * as path from 'path';

  describe('OpenHands-Tab E2E', function() {
    this.timeout(120000);

    it('opens the tab and renders HTML', async () => {
      const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
      const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
      const extensionDevelopmentPath = path.resolve(__dirname, '../../');
      const extensionTestsPath = path.resolve(__dirname, './suite');

      // Optional: pre-install deps/build here

      await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: ['--disable-extensions'],
      });
    });
  });

- Create test/e2e/suite/index.ts that activates the extension, executes the openhands.openTab command, and (optionally) inspects webview HTML via the panel API.
- Add npm scripts:
  - "e2e": "npm run compile && mocha -r ts-node/register test/e2e/**/*.test.ts"
  - Or: use a separate bootstrap that invokes @vscode/test-electron’s runTests directly.

Notes and gotchas
- Webview testing: Direct DOM access from the test process isn’t available. Consider asserting webview HTML contains known markers (e.g., <title>OpenHands Tab</title>) by capturing html returned from the panel setup, or instrumenting the extension to expose a diagnostics API during tests (e.g., via a command that returns current panel state).
- Agent-server dependency: For fully integrated tests (send message and read streamed events), ensure the server is reachable. In CI, you can launch a local agent-server or point to a remote test instance and inject SESSION_API_KEY if required.
- Stability: Start with smoke tests (activation + command execution + panel created). Add network-dependent assertions once the server contract is stable.

Minimal smoke test acceptance (manual or automated)
- VS Code launches with the extension
- Command "OpenHands: Open Tab" succeeds and a panel appears
- Command "OpenHands: Start New Conversation" succeeds (HTTP 201)
- WebSocket connects (status shows online) and events stream when you send a message

Future CI integration
- Add a GitHub Actions job that:
  - Uses ubuntu-latest, Node 22
  - npm ci && npm run compile
  - (Optional) starts agent-server in the background
  - Runs e2e script that uses @vscode/test-electron
  - Uploads screenshots/logs as artifacts on failure

References
- VS Code extension testing: https://github.com/microsoft/vscode-test
- Electron VS Code runner: https://github.com/microsoft/vscode-test/tree/main/sample
- Our headless desktop recipe: see .openhands/microagents/setup-vscode
