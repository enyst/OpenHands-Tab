# VS Code Local Setup for AI Agents

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
- A new window (Dev Host) opens with the extension loaded

### B. From terminal using the code CLI
```bash
# From the repo root
code --extensionDevelopmentPath="$(pwd)"
```
Optional isolation (separate profile and extensions dir):
```bash
code \
  --user-data-dir=/tmp/vscode-profile \
  --extensions-dir=/tmp/vscode-extensions \
  --extensionDevelopmentPath="$(pwd)"
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
- OpenHands: Open Tab — opens the main tab
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
