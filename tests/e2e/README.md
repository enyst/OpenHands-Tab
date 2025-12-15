# E2E Tests

This folder contains E2E test scaffolding using @vscode/test-electron.

## Test Files

### Entry Point Tests (*.test.ts)
Each test file orchestrates a VS Code instance and runs a specific test suite:

- **open.test.ts**: Basic smoke test - opens the chat view and executes commands
- **diagnostics.test.ts**: Tests the diagnostics command structure
- **agentSdkEvents.test.ts**: Tests agent-sdk event rendering in the webview
- **settings.test.ts**: Tests settings and configuration commands
- **history.test.ts**: Tests conversation history and restore functionality
- **messaging.test.ts**: Tests message events and rendering
- **serverSelection.test.ts**: Tests server selection and local/remote mode switching
- **confirmation.test.ts**: Tests action confirmation workflow with security levels
- **errorHandling.test.ts**: Tests error events and error state handling

### Suite Files (suite/*.ts)
These run inside VS Code and execute the actual tests:

- **suite/index.ts**: Routes to the appropriate test based on TEST_NAME env var
- **suite/agentSdkEvents.ts**: Exercises all agent-sdk event types
- **suite/settings.ts**: Tests extension commands and diagnostics structure
- **suite/history.ts**: Tests conversation state and event backlog
- **suite/messaging.ts**: Tests message event rendering and multi-part content
- **suite/serverSelection.ts**: Tests mode switching and diagnostics state
- **suite/confirmation.ts**: Tests actions with different security risk levels
- **suite/errorHandling.ts**: Tests error events and recovery

### Helper Files
- **testHelpers.ts**: Utility functions including VS Code download with retry

## Run locally

```bash
npm run e2e
```

## Test Coverage

### Agent-SDK Events Test
Verifies that all event types from the OpenHands agent-sdk are properly rendered:

- SystemPromptEvent
- ActionEvent (with/without execution, different security risk levels)
- ObservationEvent
- UserRejectObservation
- MessageEvent (user, assistant, system roles)
- AgentErrorEvent
- PauseEvent
- Condensation
- ConversationStateUpdateEvent (filtered out, not rendered)

### Settings Test
Verifies extension commands and configuration:

- Diagnostics command structure
- Configure command execution
- Reconnect command
- Start new conversation command
- Pause and resume commands

### History Test
Verifies conversation management:

- Conversation ID tracking
- Event backlog management
- Test event injection and querying
- Conversation reset behavior

### Messaging Test
Verifies message handling and rendering:

- User messages with different content types
- Assistant messages with reasoning
- Action events with observations
- Multi-part content messages
- System prompt events

### Server Selection Test
Verifies mode switching and server configuration:

- Local vs remote mode detection
- Status reporting
- Terminal state tracking
- Mode persistence across operations

### Confirmation Test
Verifies action confirmation workflow:

- Actions with LOW/MEDIUM/HIGH security risks
- Actions with UNKNOWN risk (missing field)
- User rejection handling
- ConversationStateUpdateEvent filtering
- Unexecuted actions (null action)

### Error Handling Test
Verifies error event handling:

- AgentErrorEvent rendering
- ConversationErrorEvent rendering
- Multiple sequential errors
- Failed observations (non-zero exit codes)
- Recovery via new conversation
- Condensation events

## Internal Commands Used

The tests use these internal extension commands:

- `openhands._diagnostics`: Returns extension state for verification
- `openhands._sendTestEvent`: Injects mock events into the webview
- `openhands._queryRenderedEvents`: Queries webview rendered state

## Notes

- Tests use `@vscode/test-electron` to launch real VS Code instances
- Each test runs in isolated user data directories
- Tests require network access to download VS Code (cached after first run)
- The tests verify actual webview rendering through the query mechanism
- For deeper DOM verification, use headless desktop with UI automation
