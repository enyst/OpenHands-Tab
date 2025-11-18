#!/usr/bin/env bash
# Start a headless VS Code desktop via Xvfb + Fluxbox + x11vnc + noVNC
# Usage: [DISPLAY=:1] [VNC_PORT=5901] [NOVNC_PORT=12000] [RES=1280x800x24] ./scripts/start-remote-vscode.sh

DISPLAY=${DISPLAY:-:1}
VNC_PORT=${VNC_PORT:-5901}
NOVNC_PORT=${NOVNC_PORT:-12000}
RES=${RES:-1280x800x24}
WEBROOT=${WEBROOT:-/usr/share/novnc}

mkdir -p /tmp ~/.vnc

# Xvfb
if [ -f /tmp/xvfb.pid ] && ps -p "$(cat /tmp/xvfb.pid)" >/dev/null 2>&1; then
  echo "Xvfb already running with PID $(cat /tmp/xvfb.pid)"
else
  echo "Starting Xvfb on $DISPLAY with $RES"
  Xvfb "$DISPLAY" -screen 0 "$RES" -nolisten tcp > /tmp/xvfb.log 2>&1 &
  echo $! > /tmp/xvfb.pid
fi

# Fluxbox
if [ -f /tmp/wm.pid ] && ps -p "$(cat /tmp/wm.pid)" >/dev/null 2>&1; then
  echo "Fluxbox already running with PID $(cat /tmp/wm.pid)"
else
  echo "Starting Fluxbox"
  fluxbox -display "$DISPLAY" > /tmp/fluxbox.log 2>&1 &
  echo $! > /tmp/wm.pid
fi

# VNC password
if [ ! -f ~/.vnc/passwd ]; then
  PASS=$(openssl rand -base64 24)
  x11vnc -storepasswd "$PASS" ~/.vnc/passwd >/dev/null 2>&1
  echo "$PASS" > /tmp/vnc_password
  chmod 600 ~/.vnc/passwd /tmp/vnc_password
  echo "Generated VNC password and stored plaintext at /tmp/vnc_password"
fi

# x11vnc (backgrounds itself)
if ! netstat -tln | grep -q ":$VNC_PORT "; then
  echo "Starting x11vnc on port $VNC_PORT"
  x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -forever -shared -rfbauth ~/.vnc/passwd -noxdamage -repeat -bg -o /tmp/x11vnc.log
else
  echo "x11vnc already listening on $VNC_PORT"
fi

# websockify/noVNC
NOVNC_PID_FILE="/tmp/novnc.${NOVNC_PORT}.pid"
if ! netstat -tln | grep -q ":$NOVNC_PORT "; then
  echo "Starting websockify on $NOVNC_PORT -> localhost:$VNC_PORT"
  websockify --web "$WEBROOT" --heartbeat 30 "$NOVNC_PORT" localhost:"$VNC_PORT" > "/tmp/novnc.${NOVNC_PORT}.log" 2>&1 &
  echo $! > "$NOVNC_PID_FILE"
else
  echo "websockify already listening on $NOVNC_PORT"
fi

# VS Code
if [ -f /tmp/code.pid ] && ps -p "$(cat /tmp/code.pid)" >/dev/null 2>&1; then
  echo "VS Code already running with PID $(cat /tmp/code.pid)"
else
  echo "Starting VS Code (extension dev mode)"
  code \
    --user-data-dir=/tmp/vscode-profile \
    --extensions-dir=/tmp/vscode-extensions \
    --no-sandbox \
    --disable-gpu \
    --extensionDevelopmentPath="$(pwd)" \
    > /tmp/code.log 2>&1 &
  echo $! > /tmp/code.pid
fi

# Summary
echo "--- Summary ---"
echo "DISPLAY=$DISPLAY RES=$RES"
echo "VNC: tcp://0.0.0.0:$VNC_PORT (auth: ~/.vnc/passwd)"
echo "noVNC: http://<host>:$NOVNC_PORT/vnc.html?autoconnect=true"
echo "PIDs: Xvfb=$(cat /tmp/xvfb.pid 2>/dev/null), Fluxbox=$(cat /tmp/wm.pid 2>/dev/null), noVNC=$(cat "$NOVNC_PID_FILE" 2>/dev/null), Code=$(cat /tmp/code.pid 2>/dev/null)"
