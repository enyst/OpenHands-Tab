# Add comprehensive test coverage for extension.ts

**Priority**: P0 - Critical
**Labels**: testing, coverage, enhancement
**Effort**: Large (3-5 days)

## Problem

The main extension entry point (`src/extension.ts`, 482 lines) currently has **0% test coverage**. This file is the most critical component of the extension, handling:

- Command registration and handlers
- WebView panel lifecycle management
- Message routing between webview and extension host
- ConnectionManager and BashEventsClient orchestration
- Settings propagation and configuration change listeners
- Terminal integration for bash events
- Workspace state management

Without tests, we have no automated verification that:
- Commands are registered correctly
- Message routing works as expected
- Integration between modules functions properly
- Configuration changes propagate correctly
- Resources are cleaned up on disposal

## Proposed Solution

Create `src/__tests__/extension.test.ts` with comprehensive unit tests covering all functionality in extension.ts.

## Tasks

### Extension Activation (4 tests)
- [ ] Test extension activates without errors
- [ ] Test all commands are registered (openTab, startNewConversation, configure, reconnect, pause, resume)
- [ ] Test ConnectionManager and BashEventsClient initialization
- [ ] Test configuration change listeners are set up

### openTab Command (5 tests)
- [ ] Test creates webview panel if none exists
- [ ] Test reveals existing panel if already open
- [ ] Test sets correct panel title and icon
- [ ] Test loads webview HTML with proper CSP headers
- [ ] Test initializes ConnectionManager on first open

### Command Handlers (7 tests)
- [ ] Test startNewConversation calls ConnectionManager.startNewConversation()
- [ ] Test configure opens VS Code settings
- [ ] Test reconnect calls ConnectionManager.connect()
- [ ] Test reconnect reinitializes BashEventsClient
- [ ] Test pause calls ConnectionManager.pause()
- [ ] Test resume calls ConnectionManager.resume()
- [ ] Test error handling for each command

### Message Routing (7 tests)
- [ ] Test routes "send" to ConnectionManager.sendUserMessage()
- [ ] Test routes "approve" to ConnectionManager.approveAction()
- [ ] Test routes "reject" to ConnectionManager.rejectAction()
- [ ] Test routes "reconnect" to reconnect command
- [ ] Test routes "startNewConversation" to startNewConversation command
- [ ] Test routes "openSettings" to configure command
- [ ] Test ignores unknown message types gracefully

### Event Streaming (4 tests)
- [ ] Test forwards ConnectionManager events to webview
- [ ] Test forwards status updates to webview
- [ ] Test forwards errors to webview
- [ ] Test forwards config updates to webview

### Bash Events Integration (5 tests)
- [ ] Test creates terminal on first bash command
- [ ] Test reuses existing terminal for subsequent commands
- [ ] Test writes bash output to terminal
- [ ] Test handles terminal disposal
- [ ] Test handles BashEventsClient errors

### Settings Updates (4 tests)
- [ ] Test updates ConnectionManager.setServerUrl on serverUrl change
- [ ] Test updates ConnectionManager.setSettings on LLM settings change
- [ ] Test updates BashEventsClient on serverUrl change
- [ ] Test updates session API key on secret change

### Panel Lifecycle (3 tests)
- [ ] Test cleans up on panel disposal
- [ ] Test disposes ConnectionManager on panel close
- [ ] Test disposes BashEventsClient on panel close

### Workspace State (2 tests)
- [ ] Test saves conversation ID to workspace state
- [ ] Test restores conversation ID from workspace state

### E2E Test Support (4 tests)
- [ ] Test _diagnostics returns webview HTML
- [ ] Test _sendTestEvent injects event into webview
- [ ] Test _queryRenderedEvents queries webview state
- [ ] Test _injectBashEvent injects bash event

## Acceptance Criteria

- [ ] All 45+ test cases pass
- [ ] Coverage for extension.ts increases from 0% to at least 80%
- [ ] Tests use proper mocking for VS Code APIs
- [ ] Tests are isolated and don't depend on external services
- [ ] CI pipeline runs tests successfully

## Testing Strategy

Use Vitest with mocked VS Code APIs:
```typescript
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: vi.fn(),
    showInformationMessage: vi.fn(),
    createTerminal: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
  },
  // ... other VS Code API mocks
}));
```

## Impact

- **High priority**: This is the main entry point with zero coverage
- Closes the biggest gap in test coverage
- Prevents regressions in core extension functionality
- Improves confidence in refactoring and maintenance

## Related Files

- `src/extension.ts` (482 lines)
- `src/connection/ConnectionManager.ts`
- `src/terminal/BashEventsClient.ts`
- `src/settings/SettingsManager.ts`
