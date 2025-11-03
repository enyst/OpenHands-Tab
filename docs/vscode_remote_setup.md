# VS Code Remote Setup for AI Agents

This guide explains how to set up VS Code in a headless remote environment with browser-based access via noVNC. This is specifically designed for AI agents that need to interact with VS Code through a web browser in sandboxed or remote environments.

## Use Case

This setup is intended for:
- AI agents running in remote/cloud environments without physical displays
- Automated testing scenarios requiring visual validation
- Remote development environments where direct desktop access isn't available
- Environments like the OpenHands work-1/work-2 hosts

## Architecture

```text
┌─────────────────────────────────────────────────┐
│  Remote Host (no physical display)              │
│                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Xvfb    │───▶│ Fluxbox  │───▶│  VS Code │  │
│  │ (Virtual │    │   (WM)   │    │          │  │
│  │ Display) │    │          │    │          │  │
│  └──────────┘    └──────────┘    └──────────┘  │
│       │                                          │
│       ▼                                          │
│  ┌──────────┐    ┌──────────┐                   │
│  │  x11vnc  │───▶│websockify│                   │
│  │  (VNC)   │    │ (noVNC)  │                   │
│  └──────────┘    └──────────┘                   │
│                        │                         │
└────────────────────────┼─────────────────────────┘
                         │
                         ▼ Port 12000
                   ┌──────────┐
                   │ Browser  │ (AI Agent Access)
                   │ (noVNC)  │
                   └──────────┘
```

## Prerequisites

- Ubuntu/Debian-based system
- Root or sudo access
- Node.js 22+
- Exposed web port (default: 12000)

## Step-by-Step Setup

### 1. Install Required Packages

```bash
# Update package list
apt-get update

# Install X server, VNC, window manager, and utilities
apt-get install -y \
  xvfb \
  x11vnc \
  novnc \
  websockify \
  fluxbox \
  imagemagick \
  wget \
  ca-certificates

# Download and install VS Code
wget -O /tmp/code.deb "https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64"
apt-get install -y /tmp/code.deb
```

### 2. Set Up VNC Authentication

```bash
# Create VNC directory
mkdir -p ~/.vnc

# Generate a secure random password
x11vnc -storepasswd "$(openssl rand -base64 24)" ~/.vnc/passwd

# Note: Save this password if you need it later
# You can also use a custom password instead of the random one
```

### 3. Start Virtual Display Services

```bash
# Set display number (can be :1, :2, etc. if :1 is taken)
export DISPLAY=:1

# Start Xvfb (virtual framebuffer X server)
# Screen resolution: 1280x800, 24-bit color depth
Xvfb :1 -screen 0 1280x800x24 -nolisten tcp > /tmp/xvfb.log 2>&1 &
echo $! > /tmp/xvfb.pid

# Start Fluxbox (lightweight window manager)
fluxbox -display :1 > /tmp/fluxbox.log 2>&1 &
echo $! > /tmp/wm.pid

# Start x11vnc (VNC server)
x11vnc \
  -display :1 \
  -rfbport 5901 \
  -forever \
  -shared \
  -rfbauth ~/.vnc/passwd \
  -noxdamage \
  -repeat \
  -bg \
  -o /tmp/x11vnc.log

# Start websockify (WebSocket proxy for noVNC)
websockify \
  --web /usr/share/novnc \
  --heartbeat 30 \
  12000 \
  localhost:5901 \
  > /tmp/novnc.log 2>&1 &
echo $! > /tmp/novnc.pid
```

### 4. Prepare the OpenHands-Tab Extension

```bash
# Navigate to the extension directory
cd /path/to/OpenHands-Tab

# Install dependencies
npm ci || npm install

# Compile the extension
npm run compile
```

### 5. Launch VS Code in Development Mode

```bash
# Launch VS Code with the extension loaded
code \
  --user-data-dir=/tmp/vscode-profile \
  --extensions-dir=/tmp/vscode-extensions \
  --no-sandbox \
  --disable-gpu \
  --extensionDevelopmentPath=$(pwd) \
  > /tmp/code.log 2>&1 &
echo $! > /tmp/code.pid
```

**Flag explanations:**
- `--user-data-dir`: Isolated profile for testing
- `--extensions-dir`: Separate extensions directory
- `--no-sandbox`: Required for running as root (common in containers)
- `--disable-gpu`: Prevents GPU-related issues in headless environments
- `--extensionDevelopmentPath`: Loads the extension in development mode

### 6. Access VS Code via Browser

Navigate to the noVNC web interface:

**Local URL:**
`http://localhost:12000/vnc.html?autoconnect=true`

**Remote host (e.g., OpenHands work environments):**
`https://work-1-<your-suffix>.prod-runtime.all-hands.dev/vnc.html?autoconnect=true`

You'll be prompted for the VNC password set in step 2.

### 7. Test the Extension

Once connected to the desktop via noVNC:

1. You should see VS Code running with Fluxbox window manager
2. Run command: **"OpenHands: Configure"**
   - Set server URL (default: `http://localhost:3000`)
3. Run command: **"OpenHands: Open Tab"**
4. Run command: **"OpenHands: Start New Conversation"**
5. Type a message and verify the extension works

### 8. Optional: Capture Screenshots

```bash
# Take a screenshot of the current display
xwd -display :1 -root | convert xwd:- ./screenshot.png

# This is useful for debugging or creating documentation
```

## Service Management

### Check Service Status

```bash
# Check if services are running
ps aux | grep -E "Xvfb|fluxbox|x11vnc|websockify|code"

# Check logs
tail -f /tmp/xvfb.log
tail -f /tmp/x11vnc.log
tail -f /tmp/novnc.log
tail -f /tmp/code.log
```

### Stop Services

```bash
# Stop all services
kill $(cat /tmp/code.pid) 2>/dev/null
kill $(cat /tmp/novnc.pid) 2>/dev/null
killall x11vnc
kill $(cat /tmp/wm.pid) 2>/dev/null
kill $(cat /tmp/xvfb.pid) 2>/dev/null

# Clean up PID files
rm -f /tmp/*.pid
```

### Restart Services

```bash
# Use the stop commands above, then run the start commands from step 3 again
```

## Troubleshooting

### Problem: "Cannot open display :1"

**Solution:** Xvfb isn't running or DISPLAY variable not set
```bash
export DISPLAY=:1
ps aux | grep Xvfb  # Check if running
# If not running, restart from step 3
```

### Problem: "Port 12000 already in use"

**Solution:** Change the port or kill the existing process
```bash
# Find what's using the port
lsof -i :12000

# Use a different port
websockify --web /usr/share/novnc 12001 localhost:5901 &
```

### Problem: noVNC shows black screen

**Solution:**
1. Check if Fluxbox is running: `ps aux | grep fluxbox`
2. Check x11vnc logs: `tail -f /tmp/x11vnc.log`
3. Try clicking in the noVNC window and right-clicking to see Fluxbox menu

### Problem: VS Code won't start

**Solution:**
1. Check logs: `tail -f /tmp/code.log`
2. Try without `--no-sandbox` if not running as root
3. Ensure `/tmp/vscode-profile` has write permissions

## Environment-Specific Notes

### OpenHands work-1/work-2 Hosts

These hosts typically:
- Expose ports via HTTPS (e.g., `https://work-1-xxx.prod-runtime.all-hands.dev`)
- Port 12000 maps to `https://<host>/`
- May have `SESSION_API_KEY` environment variable for agent-server authentication
- Already have most dependencies installed

### Docker Containers

Add to your Dockerfile:
```dockerfile
RUN apt-get update && apt-get install -y \
    xvfb x11vnc novnc websockify fluxbox \
    imagemagick wget ca-certificates

# Install VS Code
RUN wget -O /tmp/code.deb \
    "https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64" && \
    apt-get install -y /tmp/code.deb && \
    rm /tmp/code.deb
```

## Security Considerations

**WARNING:** This setup is intended for development/testing in isolated environments.

- VNC password provides minimal security
- noVNC traffic is unencrypted (use HTTPS proxy in production)
- `--no-sandbox` flag reduces Chrome security (required in some container environments)
- Temporary profile directories may contain sensitive data

**For production:** Use proper authentication, HTTPS, and consider SSH tunneling for VNC.

## Related Documentation

- [E2E Testing Guide](./e2e_testing.md) - Automated E2E tests (not using this remote setup)
- [README.md](../README.md) - General extension documentation
- [PRD.md](./PRD.md) - Product requirements and architecture

## References

- [Xvfb Manual](https://www.x.org/releases/X11R7.6/doc/man/man1/Xvfb.1.xhtml)
- [noVNC Documentation](https://github.com/novnc/noVNC)
- [VS Code CLI](https://code.visualstudio.com/docs/editor/command-line)
- [Fluxbox](http://fluxbox.org/)
