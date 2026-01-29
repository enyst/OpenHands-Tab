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
- **uiFlows.test.ts**: Tests UI flows via command-driven harness (non-UI automation)
- **uiFlowsUi.test.ts**: UI-driven smoke test using CDP (gated by `E2E_UI=1`). The context picker
  selection is skipped if no workspace file options appear within the timeout (see bead `oh-tab-puxi`).
- **serverSelection.test.ts**: Tests server selection and local/remote mode switching
- **llmSwitching.test.ts**: Tests switching LLM provider/model/api mode (local, mock server)
- **confirmation.test.ts**: Tests action confirmation workflow with security levels
- **errorHandling.test.ts**: Tests error events and error state handling
- **agentServerRemote.test.ts**: (Optional) Starts a local python agent-server and tests remote mode end-to-end (gated by `E2E_AGENT_SERVER=1`)
- **agentServerRemoteAuth.test.ts**: (Optional) Starts a local python agent-server with `SESSION_API_KEY` enabled and tests runtime-key auth end-to-end (gated by `E2E_AGENT_SERVER=1`)
- **agentServerRemoteCloudBootstrap.test.ts**: (Optional) Starts a local python agent-server + local mock SaaS server and tests cloud bootstrap wiring end-to-end (gated by `E2E_AGENT_SERVER=1`)

### Suite Files (suite/*.ts)
These run inside VS Code and execute the actual tests:

- **suite/index.ts**: Routes to the appropriate test based on TEST_NAME env var
- **suite/agentSdkEvents.ts**: Exercises all agent-sdk event types
- **suite/settings.ts**: Tests extension commands and diagnostics structure
- **suite/history.ts**: Tests conversation state and event backlog
- **suite/messaging.ts**: Tests message event rendering and multi-part content
- **suite/uiFlows.ts**: Exercises UI flows via host-side commands
- **suite/uiFlowsUi.ts**: Exercises UI flows via CDP-based UI automation
- **suite/serverSelection.ts**: Tests mode switching and diagnostics state
- **suite/llmSwitching.ts**: Exercises local LLM switching against a mock server
- **suite/confirmation.ts**: Tests actions with different security risk levels
- **suite/errorHandling.ts**: Tests error events and recovery

### Helper Files
- **testHelpers.ts**: Utility functions including VS Code download with retry

## Scripted mock LLM server

Many E2Es use the scripted mock server in `tests/e2e/suite/mockLlmServer.ts` to simulate provider behavior deterministically.

### Path matching

Each `MockLlmScript` matches either:
- the **raw** request path (e.g. `/v1/chat/completions` or `/api/v1/chat/completions`), or
- the **normalized** path with `/v1` and `/api/v1` prefixes stripped (e.g. `/chat/completions`).

Scripts are searched from newest → oldest, so later `setScript(...)` calls override earlier ones.

### SSE framing

When using scripted SSE responses, each SSE event must be terminated by a blank line (`\n\n`). The scripted server handles this for you by emitting `data: ...\n\n` for each `events[]` entry, including when the last event is `[DONE]`.

### Example: context-limit first, then success

```ts
import { startMockLlmServer } from './mockLlmServer';

const mock = await startMockLlmServer({
  scripts: [
    {
      // Either raw or normalized paths work; normalized is usually simpler.
      path: '/chat/completions',
      responses: [
        {
          type: 'json',
          status: 400,
          body: {
            error: {
              code: 'context_length_exceeded',
              message: 'Context length exceeded',
            },
          },
        },
        {
          type: 'sse',
          status: 200,
          events: [
            { data: { choices: [{ delta: { content: [{ type: 'text', text: 'OK' }] } }] } },
            {
              data: {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
              },
            },
            { data: '[DONE]' },
          ],
        },
      ],
    },
  ],
});

// Use `mock.baseUrl` as the provider base URL in your test settings.
```

## Run locally

```bash
npm run e2e
```

UI-driven flows (Playwright CDP):
```bash
E2E_UI=1 npm run e2e
```

## Multi-root workspace E2E

Some suites need multi-root workspace coverage. To launch VS Code against a `.code-workspace` file, pass it via `--file-uri` in `runTests({ launchArgs })`:

```ts
import { pathToFileURL } from 'url';

launchArgs: [
  // ...
  `--file-uri=${pathToFileURL(workspaceFile).toString()}`,
],
```

See `tests/e2e/tpq.test.ts` for a concrete example that creates a temporary workspace with two folders.

### Remote agent-server E2E (optional)

Requires:
- `uv` installed
- a local agent-sdk checkout (default `~/repos/agent-sdk`)

Run:
```bash
E2E_AGENT_SERVER=1 npm run e2e
```

## Local Conversation Storage

In local mode, the extension persists conversation history/events to `~/.openhands/conversations-vscode/` by default.

To override the storage directory (useful for CI runners or read-only home dirs), set the VS Code setting `openhands.conversation.storeRoot`.

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

The tests use these internal extension commands (test-only; not a stable public API):

- `openhands._diagnostics`: Returns extension state for verification
- `openhands._queryRenderedEvents`: Queries webview rendered state
- `openhands._queryUiState`: Queries webview UI state (welcome, counts, toggles, etc.)
- `openhands._sendTestEvent`: Injects mock events into the webview
- `openhands._injectTerminalEvent`: Injects terminal events into the webview/terminal log
- `openhands._queryLastError`: Returns the most recent error captured by the extension
- `openhands._queryHalState`: Returns HAL overlay state (enabled/phase/teleport state)
- `openhands._webviewAction`: Performs a small scripted UI action in the webview (send message, open panels, etc.)
- `openhands._queryLastObservation`: Returns the most recent tool observation snapshot (used by oracle suites)
- `openhands._serversSet`: Sets the saved server list + current server selection (used by remote-mode suites)
- `openhands._setProviderApiKey`: Stores a provider API key for the E2E run
- `openhands._listProfiles`: Lists LLM profiles
- `openhands._createProfile`: Creates an LLM profile
- `openhands._updateProfile`: Updates an LLM profile
- `openhands._deleteProfile`: Deletes an LLM profile
- `openhands._selectProfile`: Selects the active LLM profile (or clears selection)
- `openhands._setProfileApiKey`: Stores an API key for a specific profile
- `openhands._testMarkAgentEditedFile`: Marks a file as “agent edited” for test assertions

If you add a new suite that requires a new internal command, update this section so the docs stay in sync with harness usage.

## Notes

- Tests use `@vscode/test-electron` to launch real VS Code instances
- Each test runs in isolated user data directories
- Tests require network access to download VS Code (cached after first run)
- The tests verify actual webview rendering through the query mechanism
- For deeper DOM verification, use headless desktop with UI automation
