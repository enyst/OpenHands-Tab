# E2E Tests

This folder contains minimal E2E scaffolding using @vscode/test-electron.

## Test Files

- **openTab.test.ts**: orchestrates a VS Code instance and runs the suite entry.
- **diagnostics.test.ts**: tests the diagnostics command.
- **agentSdkEvents.test.ts**: tests agent-sdk event rendering in the webview.
- **suite/index.ts**: called by the VS Code runner; triggers extension commands.
- **suite/agentSdkEvents.ts**: exercises all agent-sdk event types (SystemPromptEvent, ActionEvent, ObservationEvent, MessageEvent, etc.)

## Run locally

```bash
npm run e2e
```

## Agent-SDK Events Test

The agentSdkEvents test verifies that all event types from the OpenHands agent-sdk are properly rendered in the webview:

- SystemPromptEvent
- ActionEvent (with/without execution, different security risk levels)
- ObservationEvent
- UserRejectObservation
- MessageEvent (user, assistant, system roles)
- AgentErrorEvent
- PauseEvent
- Condensation
- ConversationStateUpdateEvent

The test uses the internal `openhands._sendTestEvent` command to inject mock events into the webview.

## Notes

- These are smoke tests. They don't yet verify webview DOM. For deeper checks, expose a diagnostics command in the extension or use a headless desktop with UI automation.
- The e2e tests require network access to download VS Code. They may fail in network-restricted environments.
