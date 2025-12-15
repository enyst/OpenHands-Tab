# E2E Tests

This folder contains minimal E2E scaffolding using @vscode/test-electron.

## Test Files

- **open.test.ts**: orchestrates a VS Code instance and runs the suite entry.
- **diagnostics.test.ts**: tests the diagnostics command.
- **agentSdkEvents.test.ts**: tests agent-sdk event rendering in the webview.
- **suite/index.ts**: called by the VS Code runner; triggers extension commands.
- **suite/agentSdkEvents.ts**: exercises all agent-sdk event types (SystemPromptEvent, ActionEvent, ObservationEvent, MessageEvent, etc.)

## Run locally

```bash
npm run e2e
```

## Local Conversation Storage

In local mode, the extension persists conversation history/events to `~/.openhands/conversations-vscode/` by default.

To override the storage directory (useful for CI runners or read-only home dirs), set VS Code setting `openhands.conversation.storeRoot`.

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
- ConversationStateUpdateEvent (filtered out, not rendered)

The test:
1. Uses `openhands._sendTestEvent` to inject 14 mock events into the webview
2. Uses `openhands._queryRenderedEvents` to query the webview's actual rendered state
3. Verifies that exactly 13 events were rendered (14 sent minus 1 ConversationStateUpdateEvent which is filtered)
4. Verifies the event types match the expected sequence

This ensures the webview actually receives, processes, and renders the events correctly.

## Notes

- These are smoke tests. They don't yet verify webview DOM. For deeper checks, expose a diagnostics command in the extension or use a headless desktop with UI automation.
- The e2e tests require network access to download VS Code. They may fail in network-restricted environments.
