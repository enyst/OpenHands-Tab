#!/usr/bin/env bash
# Start the Python OpenHands agent-server from a local agent-sdk checkout.
#
# Usage:
#   [AGENT_SDK_DIR=~/repos/agent-sdk] [HOST=0.0.0.0] [PORT=3000] [RELOAD=0] [PREPARE=0] ./scripts/start-agent-server.sh
#
# Notes:
# - This script expects a local clone of https://github.com/OpenHands/software-agent-sdk
# - The extension should be configured with: openhands.serverUrl = http://localhost:$PORT

set -euo pipefail

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-3000}
RELOAD=${RELOAD:-0}
PREPARE=${PREPARE:-0}
AGENT_SDK_DIR=${AGENT_SDK_DIR:-${OPENHANDS_AGENT_SDK_DIR:-"$HOME/repos/agent-sdk"}}

if [ ! -d "$AGENT_SDK_DIR" ]; then
  echo "agent-sdk directory not found: $AGENT_SDK_DIR" >&2
  echo "Set AGENT_SDK_DIR (or OPENHANDS_AGENT_SDK_DIR) to your local agent-sdk checkout." >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "'uv' is required to run agent-server but was not found on PATH." >&2
  echo "Install uv: https://docs.astral.sh/uv/" >&2
  exit 1
fi

if [ ! -f "$AGENT_SDK_DIR/openhands-agent-server/openhands/agent_server/README.md" ]; then
  echo "Expected agent-server sources not found under: $AGENT_SDK_DIR" >&2
  echo "This should be a clone of: https://github.com/OpenHands/software-agent-sdk" >&2
  exit 1
fi

cd "$AGENT_SDK_DIR"

if [ "$PREPARE" = "1" ]; then
  echo "Running: make build"
  make build
fi

args=(python -m openhands.agent_server --host "$HOST" --port "$PORT")
if [ "$RELOAD" = "1" ]; then
  args+=(--reload)
fi

echo "Starting OpenHands Agent Server..."
echo "  Repo:  $AGENT_SDK_DIR"
echo "  URL:   http://localhost:$PORT"
echo "  Cmd:   uv run ${args[*]}"
if [ -n "${SESSION_API_KEY:-}" ]; then
  echo "  Auth:  SESSION_API_KEY is set (extension must support it)"
fi
echo ""
echo "VS Code tip: set openhands.serverUrl to http://localhost:$PORT"
echo ""

exec uv run "${args[@]}"
