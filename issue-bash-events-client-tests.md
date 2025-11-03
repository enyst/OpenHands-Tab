# Add comprehensive test coverage for BashEventsClient

**Priority**: P1 - High
**Labels**: testing, coverage, websocket, terminal
**Effort**: Medium (2-3 days)

## Problem

`src/terminal/BashEventsClient.ts` (147 lines) currently has only **~20% test coverage**. This module manages a separate WebSocket connection for real-time bash command streaming to the integrated terminal.

**Current coverage:**
- ✅ Basic initialization tested
- ✅ `setServerUrl()` tested
- ✅ Type guards tested (in separate file)
- ❌ WebSocket lifecycle completely untested (connect, disconnect, error handling)
- ❌ Event parsing and validation untested
- ❌ Reconnection logic untested
- ❌ Callback mechanisms untested
- ❌ Error scenarios untested

Without comprehensive tests, we cannot ensure:
- WebSocket connection establishes correctly
- Reconnection with exponential backoff works
- Events are parsed and validated properly
- Error handling doesn't crash the extension
- Resources are cleaned up on disconnect

## Current Test Coverage

**Existing test file**: `src/terminal/__tests__/BashEventsClient.test.ts` (113 lines)
- Only tests type guards and basic initialization
- Does not test any WebSocket operations
- Does not test reconnection logic
- Does not test event callbacks

## Proposed Solution

Create `src/terminal/__tests__/BashEventsClient.lifecycle.test.ts` with comprehensive tests for WebSocket lifecycle and event handling.

## Tasks

### connect() Method (4 tests)
- [ ] Test establishes WebSocket connection to /sockets/bash-events
- [ ] Test includes session API key in query params
- [ ] Test emits "connecting" status on connect attempt
- [ ] Test emits "online" status on successful connection

### disconnect() Method (3 tests)
- [ ] Test closes WebSocket connection cleanly
- [ ] Test emits "offline" status
- [ ] Test cleans up event listeners and timers

### reconnect() Method (2 tests)
- [ ] Test disconnects and reconnects
- [ ] Test resets retry count to 0

### WebSocket Message Handling (5 tests)
- [ ] Test parses and emits BashCommand events
- [ ] Test parses and emits BashOutput events
- [ ] Test parses and emits BashExit events
- [ ] Test calls onError callback for invalid events
- [ ] Test ignores malformed JSON

### WebSocket Error Handling (3 tests)
- [ ] Test emits error on WebSocket error event
- [ ] Test calls onError callback with error details
- [ ] Test maintains "offline" status on error

### Reconnection Logic (6 tests)
- [ ] Test attempts reconnection on close event
- [ ] Test uses exponential backoff (1s, 2s, 4s, 8s, 15s)
- [ ] Test adds jitter (0-20%) to backoff delays
- [ ] Test caps backoff at maxBackoffMs (15s)
- [ ] Test increments retry count on each attempt
- [ ] Test respects retryCount state

### Session API Key Handling (2 tests)
- [ ] Test includes sessionApiKey in WebSocket URL query string
- [ ] Test updates sessionApiKey via setSessionApiKey()

### injectEvent() Method (2 tests)
- [ ] Test emits injected event without WebSocket
- [ ] Test validates injected event structure

### Status Callback (3 tests)
- [ ] Test calls onStatus with "connecting", "online", "offline"
- [ ] Test onStatus reflects actual connection state
- [ ] Test onStatus called on state transitions

## Acceptance Criteria

- [ ] All 30+ test cases pass
- [ ] Coverage for BashEventsClient.ts increases from 20% to at least 80%
- [ ] Tests use WebSocket mocking (ws library or custom mock)
- [ ] Tests verify timing for exponential backoff
- [ ] Tests verify all callbacks are invoked correctly
- [ ] CI pipeline runs tests successfully

## Testing Strategy

### WebSocket Mocking Approach

Option 1: Use `jest-websocket-mock` or similar library
```typescript
import WS from 'jest-websocket-mock';

describe('BashEventsClient - Lifecycle', () => {
  let server: WS;
  let client: BashEventsClient;

  beforeEach(() => {
    server = new WS('ws://localhost:3000/sockets/bash-events');
    client = new BashEventsClient(
      onEvent,
      onError,
      onStatus,
      'localhost:3000',
      'test-api-key'
    );
  });

  afterEach(() => {
    WS.clean();
  });

  test('connect() establishes WebSocket connection', async () => {
    client.connect();
    await server.connected;

    expect(server.url).toContain('/sockets/bash-events');
    expect(server.url).toContain('sessionApiKey=test-api-key');
  });
});
```

Option 2: Mock the `ws` library directly
```typescript
import { WebSocket } from 'ws';

vi.mock('ws', () => ({
  WebSocket: vi.fn().mockImplementation((url) => ({
    on: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
    url,
  })),
}));
```

### Exponential Backoff Testing

```typescript
test('reconnection uses exponential backoff', async () => {
  vi.useFakeTimers();

  client.connect();

  // Simulate first disconnect
  mockWs.emit('close');
  expect(onStatus).toHaveBeenCalledWith('offline');

  // First retry after ~1s
  vi.advanceTimersByTime(1000);
  expect(WebSocket).toHaveBeenCalledTimes(2);

  // Second retry after ~2s
  mockWs.emit('close');
  vi.advanceTimersByTime(2000);
  expect(WebSocket).toHaveBeenCalledTimes(3);

  // Third retry after ~4s
  mockWs.emit('close');
  vi.advanceTimersByTime(4000);
  expect(WebSocket).toHaveBeenCalledTimes(4);

  vi.useRealTimers();
});
```

### Event Parsing Testing

```typescript
test('parses and emits BashCommand events', () => {
  const onEventMock = vi.fn();
  const client = new BashEventsClient(onEventMock, ...);

  client.connect();

  const event = {
    event_id: '123',
    event_type: 'bash_command',
    command_id: 1,
    command: 'ls -la',
  };

  mockWs.emit('message', JSON.stringify(event));

  expect(onEventMock).toHaveBeenCalledWith(event);
});
```

## Impact

- **High priority**: Core terminal integration feature
- Currently only 20% tested, leaving 80% of code untested
- Prevents regressions in bash streaming functionality
- Ensures reconnection logic works reliably
- Improves confidence in error handling

## Related Files

- `src/terminal/BashEventsClient.ts` (147 lines) - Main target
- `src/terminal/__tests__/BashEventsClient.test.ts` (113 lines) - Existing tests (keep)
- `src/types/agent-sdk.ts` - Type definitions for bash events
- `src/extension.ts:166` - Usage in extension (terminal integration)

## Dependencies

- May need to add `jest-websocket-mock` or similar testing library
- Consider using Vitest's timer mocking for exponential backoff tests

## Related Issues

- Part of overall test coverage improvement initiative
- Critical for terminal integration reliability
