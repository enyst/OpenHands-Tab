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

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Start the Python OpenHands agent-server from a local agent-sdk checkout.

Usage:
  [AGENT_SDK_DIR=~/repos/agent-sdk] [HOST=0.0.0.0] [PORT=3000] [RELOAD=0] [PREPARE=0] ./scripts/start-agent-server.sh

Env:
  AGENT_SDK_DIR           Path to a local clone of https://github.com/OpenHands/software-agent-sdk
  OPENHANDS_AGENT_SDK_DIR Alias for AGENT_SDK_DIR
  HOST                    Bind host (default: 0.0.0.0)
  PORT                    Bind port (default: 3000)
  RELOAD                  1 enables --reload (default: 0)
  PREPARE                 1 runs `make build` before starting (default: 0)
EOF
  exit 0
fi

HOST=${HOST:-0.0.0.0}
PORT=${PORT:-3000}
RELOAD=${RELOAD:-0}
PREPARE=${PREPARE:-0}

HOME_DIR="${HOME:-}"
DEFAULT_AGENT_SDK_DIR=""
if [ -n "$HOME_DIR" ]; then
  DEFAULT_AGENT_SDK_DIR="$HOME_DIR/repos/agent-sdk"
fi
AGENT_SDK_DIR="${AGENT_SDK_DIR:-${OPENHANDS_AGENT_SDK_DIR:-$DEFAULT_AGENT_SDK_DIR}}"

if [ -z "${AGENT_SDK_DIR:-}" ]; then
  echo "AGENT_SDK_DIR is required (HOME is unset)." >&2
  exit 1
fi

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

if [ "$PREPARE" = "1" ] && ! command -v make >/dev/null 2>&1; then
  echo "'make' is required for PREPARE=1 but was not found on PATH." >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Set PORT=<free-port> and retry." >&2
  exit 1
fi

cd "$AGENT_SDK_DIR"

if [ "$PREPARE" = "1" ]; then
  echo "Running: make build"
  make build
fi

if ! uv run python -c 'import openhands.agent_server' >/dev/null; then
  echo "Failed to import openhands.agent_server from: $AGENT_SDK_DIR" >&2
  echo "Confirm AGENT_SDK_DIR points to: https://github.com/OpenHands/software-agent-sdk" >&2
  echo "If this is a fresh clone, try: PREPARE=1 AGENT_SDK_DIR=... npm run agent-server:prepare" >&2
  exit 1
fi

args=(python -m openhands.agent_server --host "$HOST" --port "$PORT")
if [ "$RELOAD" = "1" ]; then
  args+=(--reload)
fi

echo "Starting OpenHands Agent Server..."
echo "  Repo:  $AGENT_SDK_DIR"
echo "  Bind:  $HOST:$PORT"
echo "  URL:   http://localhost:$PORT"
echo "  Cmd:   uv run ${args[*]}"
if [ -n "${SESSION_API_KEY:-}" ]; then
  echo "  Auth:  SESSION_API_KEY is set (extension must support it)"
fi
echo ""
echo "VS Code tip: set openhands.serverUrl to http://localhost:$PORT"
echo ""

exec uv run "${args[@]}"
