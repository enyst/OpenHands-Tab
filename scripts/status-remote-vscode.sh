#!/usr/bin/env bash
# Show status of remote VS Code services

echo "--- Ports ---"
netstat -tlnp 2>/dev/null | grep -E ":5901|:12000|:12001" || echo "noVNC/x11vnc not listening on standard ports"

echo "--- PIDs ---"
for n in xvfb wm novnc novnc.12000 novnc.12001 code; do
  f="/tmp/${n}.pid"
  [ -f "$f" ] && printf "%s: %s\n" "$n" "$(cat "$f")"
done

ps aux | grep -E "Xvfb|fluxbox|x11vnc|websockify|/usr/share/code/code" | grep -v grep || true

echo "--- Logs (tails) ---"
for l in /tmp/xvfb.log /tmp/fluxbox.log /tmp/x11vnc.log /tmp/novnc.log /tmp/novnc.12001.log /tmp/code.log; do
  [ -f "$l" ] && echo "==> $l <==" && tail -n 5 "$l"
done
