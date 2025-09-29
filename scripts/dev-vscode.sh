#!/usr/bin/env bash

# Build webview and compile extension, package VSIX, then (optionally) run code-server with the extension installed.

npm run build:webview || exit 1
npm run compile || exit 1

# Package VSIX
npx vsce package --no-yarn --allow-missing-repository || exit 1
VSIX_FILE=$(ls -1 *.vsix | head -n1)
if [ -z "$VSIX_FILE" ]; then
  echo "VSIX not found after packaging" >&2
  exit 1
fi

echo "Packaged: $VSIX_FILE"

# Install to code-server if available
if command -v code-server >/dev/null 2>&1; then
  echo "Installing extension to code-server..."
  code-server --install-extension "$VSIX_FILE" || true
  echo "Starting code-server on 0.0.0.0:12000 (no auth)"
  # Open the workspace folder so the extension can run in a project context
  code-server . --auth none --bind-addr 0.0.0.0:12000
else
  echo "code-server not found. To install: curl -fsSL https://code-server.dev/install.sh | sh"
  echo "Then re-run: npm run dev:vscode"
fi
