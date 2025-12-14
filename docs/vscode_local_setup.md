# VS Code Local Setup for AI Agents


> Note on debug logging/instrumentation
>
> The webview → extension logging bridge (console/errors/network) is enabled automatically when the extension runs in Development or Test mode, and can also be enabled manually in normal installs.
>
> How to enable:
> - Automatic: launch the extension in Extension Development Host (Run/Debug) or during tests — logging is on by default.
> - Manual: open Settings and enable “OpenHands: Dev Bridge Enabled” (setting id: `openhands.devBridge.enabled`).
>
> What it does:
> - Captures webview console logs, unhandled errors, network requests and WebSocket lifecycle and forwards them to the extension.
> - Writes to Output: check the “OpenHands” output channel.
> - Writes to file (when enabled): `openhands-webview.log` inside the VS Code extension log folder.
>
> Where to find the log file:
> - Use the Command Palette: “Developer: Open Extension Logs Folder”, then open the `openhands.openhands-tab` folder and find `openhands-webview.log`.
> - Typical locations:
>   - macOS: `~/Library/Application Support/Code/logs/<timestamp>/exthost/openhands.openhands-tab/`
>   - Linux: `~/.config/Code/logs/<timestamp>/exthost/openhands.openhands-tab/`
>   - Windows: `%APPDATA%\Code\logs\<timestamp>\exthost\openhands.openhands-tab\`

This guide is for AI agents operating on a developer’s local machine. It assumes VS Code Desktop is installed and the `code` CLI is in PATH. The goal: run VS Code with the OpenHands Tab extension in development mode, refresh it when code changes, collect logs, and capture screenshots.

## Prerequisites
- VS Code Desktop installed (https://code.visualstudio.com/)
- `code` CLI available in PATH
- Node.js 22+ recommended (Node 20 works with warnings)
- Git and a shell environment

## Clone and Build
```bash
# Clone
git clone https://github.com/enyst/OpenHands-Tab.git
cd OpenHands-Tab

# Install dependencies and compile
npm ci || npm install
npm run compile
```

## Launch the Extension (Extension Development Host)
Choose one of the following:

### A. From VS Code (recommended)
- Open the folder in VS Code
- Press F5 (or Run and Debug → "Run OH-Tab")
  - Uses .vscode/launch.json to start an Extension Development Host

## Action shortcuts: Visual vs CLI

For each common action, here are both the Visual (UI) steps and equivalent CLI triggers for agents.

- Start Extension Development Host
  - Visual: Open folder → Run and Debug → "Run OH-Tab" (F5)
  - CLI: code "$(pwd)" --extensionDevelopmentPath="$(pwd)"

- Rebuild extension (backend + webview)
  - Visual: Terminal → Run Task → "npm: compile" (or use F5 which runs preLaunchTask)
  - CLI: npm run compile

- Rebuild webview only (CSS/JS)
  - Visual: Terminal → Run Task → "npm: build:webview" (or keep a watcher running)
  - CLI: npm run build:webview
  - Watch mode (fast loop): npm run watch

- Reload the VS Code window
  - Visual: Command Palette → Developer: Reload Window
  - CLI: code --command workbench.action.reloadWindow

- Restart Extension Host
  - Visual: Command Palette → Developer: Restart Extension Host
  - CLI: code --command workbench.action.restartExtensionHost

- Open Developer Tools (window)
  - Visual: Help → Toggle Developer Tools
  - CLI: code --command workbench.action.toggleDevTools

- Open Webview Developer Tools
  - Visual: Command Palette → Developer: Open Webview Developer Tools
  - CLI: Not reliably exposed via a stable command ID. Workaround: open Developer Tools (above) and select the webview iframe in the Elements panel.

Note on Webview DevTools from CLI
- Alternatives:
  - Open main DevTools via CLI and select the webview iframe: code --command workbench.action.toggleDevTools
  - Bridge logs and network from webview to extension host (recommended). This repository implements:
    - Console bridge (console.log/warn/error), window.onerror, and unhandledrejection → posted to extension → written to Output channel.
    - Network bridge: fetch wrapper and WebSocket lifecycle events → posted to extension → written to Output channel.
  - Run the webview bundle in a browser harness with a mock acquireVsCodeApi for deep inspection.


- Open Output panel (to view logs)
  - Visual: View → Output, then pick the "OpenHands" channel
  - CLI: code --command workbench.action.output.toggleOutput (opens/toggles Output; channel selection is manual)

- Open Logs Folder
  - Visual: Command Palette → Developer: Open Logs Folder
  - CLI: code --command workbench.action.openLogsFolder

- Take a screenshot
  - Visual: Use OS screenshot shortcuts, then save to media/screenshots/
  - CLI (examples):
    - macOS: screencapture -x media/screenshots/openhands-local.png
    - Linux (GNOME): gnome-screenshot -f media/screenshots/openhands-local.png
    - Linux (ImageMagick): import -window root media/screenshots/openhands-local.png
    - Windows (PowerShell, simplified): Use Snipping Tool (Snip & Sketch) via UI or third-party CLI tool

- A new window (Dev Host) opens with the extension loaded

### B. From terminal using the code CLI
```bash
# From the repo root
code "$(pwd)" --extensionDevelopmentPath="$(pwd)"
```
Optional isolation (separate profile and extensions dir):
```bash
code \
  "$(pwd)" \
  --extensionDevelopmentPath="$(pwd)" \
  --user-data-dir=/tmp/vscode-profile \
  --extensions-dir=/tmp/vscode-extensions
```

## Refreshing After Code Changes
- Webview/frontend changes:
  - Run: npm run build:webview (or npm run watch during development)
  - In the Dev Host, reload window: Developer: Reload Window (Ctrl/Cmd+R)
- Extension/backend TypeScript changes:
  - Run: npm run compile (or use F5 which runs the preLaunchTask)
  - Reload the Dev Host window if needed (Developer: Reload Window)
- Fastest loop:
  - Terminal 1: npm run watch (rebuilds TS + tailwind + webview)
  - Dev Host: Developer: Reload Window to reflect changes

## Configuration for the Agent
In the Dev Host window, use the commands:
- OpenHands: Configure — set server URL (leave blank for local mode)
- OpenHands: Open — reveals the chat sidebar view
- OpenHands: Start New Conversation — starts a new conversation

## Logs and Diagnostics
- Extension host logs:
  - View → Output → select the OpenHands output channel
  - Help → Toggle Developer Tools → Console for window logs
- Webview logs:
  - Command Palette → Developer: Open Webview Developer Tools
- VS Code log folder:
  - Developer: Open Logs Folder
- Increase log level:
  - Developer: Set Log Level → Trace

## Taking Screenshots
- Use the OS screenshot hotkeys, or DevTools screenshot if applicable
- Save to the repository for traceability, e.g. media/screenshots/
  - Example path: media/screenshots/openhands-tab-local.png

## Troubleshooting
- Missing code CLI: In VS Code, Command Palette → Shell Command: Install 'code' command in PATH
- Node version warnings: You can proceed on Node 20; for strict engines use Node 22+
- Extension not loading:
  - Ensure npm run compile succeeded
  - Reload the Dev Host window (Developer: Reload Window)
  - Check Output and Developer Tools Console for errors

## Related
- Remote setup guide (noVNC/VNC headless): docs/vscode_remote_setup.md
- Screenshot examples: media/screenshots/
