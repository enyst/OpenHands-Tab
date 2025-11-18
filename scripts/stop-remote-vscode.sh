#!/usr/bin/env bash
# Stop VS Code remote desktop services started by start-remote-vscode.sh

kill $(cat /tmp/code.pid 2>/dev/null) 2>/dev/null || true
for f in /tmp/novnc.*.pid /tmp/novnc.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
done
killall x11vnc 2>/dev/null || true
kill $(cat /tmp/wm.pid 2>/dev/null) 2>/dev/null || true
kill $(cat /tmp/xvfb.pid 2>/dev/null) 2>/dev/null || true
rm -f /tmp/*.pid

echo "Stopped remote VS Code services (if running)."