# Bash Events Live Terminal Integration

## Overview
Stream live bash command output from the OpenHands agent-server to a VS Code integrated terminal.

## Feature Description
When enabled, the extension subscribes to the agent-server's `/sockets/bash-events` WebSocket endpoint and displays bash command execution in a dedicated VS Code terminal named "OpenHands".

## Protocol
- **Endpoint**: `ws(s)://{serverUrl}/sockets/bash-events?session_api_key=...`
- **Schema**: BashEventBase (agent-sdk/openhands/agent_server/models.py)
- **Event Types**:
  - `BashCommand`: Command started
  - `BashOutput`: stdout/stderr chunk (streamed as command runs)
  - `BashExit`: Command completed with exit code

## Example Event
```json
{
  "type": "BashOutput",
  "command_id": "550e8400-e29b-41d4-a716-446655440000",
  "order": 0,
  "exit_code": null,
  "stdout": "Processing files...\n",
  "stderr": null,
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2025-01-26T12:34:56.789Z"
}
```

## Architecture
```
BashEventsClient (new)
  └─> WebSocket to /sockets/bash-events
  └─> Independent lifecycle from conversation events
  └─> Callbacks: onBashCommand, onBashOutput, onBashExit

Extension Host
  └─> Creates VS Code terminal: vscode.window.createTerminal({ name: "OpenHands" })
  └─> Writes bash output to terminal as events arrive

VS Code Terminal Panel
  └─> Standard VS Code terminal UX (scrollback, search, copy, etc.)
```

## Settings
- `openhands.bashEvents.enabled` (boolean, default: false)
  - Enable live bash output streaming to VS Code terminal

## Implementation Notes
- **Separate from conversation events**: Uses distinct WebSocket and lifecycle
- **Optional feature**: Disabled by default; no impact when off
- **VS Code native terminal**: Leverages vscode.window.createTerminal() for full terminal experience
- **Authentication**: Uses same session_api_key as conversation events

## Naming Consistency Note
The existing `ConnectionManager` should be renamed to `ConversationEventsClient` for consistency. Both are WebSocket clients, not managers. Track in separate issue/PR.

## Future Enhancements
- Terminal per conversation_id (multiple terminals for multiple conversations)
- ANSI color support (VS Code terminals support this by default)
- Terminal command history
- Click-to-open files mentioned in bash output
