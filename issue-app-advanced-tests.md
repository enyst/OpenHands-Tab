# Add advanced test coverage for App.tsx component

**Priority**: P2 - Medium-High
**Labels**: testing, coverage, ui, react
**Effort**: Large (3-4 days)

## Problem

`src/webview-src/components/App.tsx` (699 lines) is the largest component in the codebase and contains complex state management, event handling, and UI logic. Currently, it has only **~30% test coverage**.

**Current coverage:**
- ✅ Basic rendering (header, input, buttons)
- ✅ Button click actions (Send, Stop, New Chat, Reconnect, Settings)
- ✅ Some event rendering (MessageEvent, ActionEvent, etc.)
- ❌ useEffect hooks untested (message listeners, scroll, status)
- ❌ Event deduplication logic untested
- ❌ Confirmation prompt interactions untested
- ❌ Toast notification system untested
- ❌ Input field keyboard behavior untested
- ❌ Agent status tracking untested
- ❌ Many edge cases untested

Without comprehensive tests, we cannot ensure:
- Event deduplication works correctly (prevents duplicate rendering on reconnect)
- Confirmation workflow functions properly (approve/reject, timeout)
- Toast debouncing works (prevents notification spam)
- Input handling works (Enter vs Shift+Enter)
- Memory doesn't leak with large event lists
- Edge cases are handled (malformed data, rapid events)

## Current Test Coverage

**Existing test files:**
- `src/webview-src/__tests__/App.render.test.tsx` (14 lines) - Basic rendering
- `src/webview-src/__tests__/actions.test.tsx` (52 lines) - Button actions
- `src/webview-src/__tests__/event.rendering.test.tsx` (150+ lines) - Event rendering
- `src/webview-src/__tests__/toasts.test.tsx` (16 lines) - Basic toast test

**Coverage estimate**: ~30% of 699-line component

## Proposed Solution

Create `src/webview-src/__tests__/App.advanced.test.tsx` with comprehensive tests for complex state management, hooks, and user interactions.

## Tasks

### Message Listener useEffect (6 tests)
- [ ] Test attaches message event listener on mount
- [ ] Test removes listener on unmount
- [ ] Test handles "event" messages and adds to events list
- [ ] Test handles "status" messages and updates connection status
- [ ] Test handles "error" messages and shows error toast
- [ ] Test handles "config" messages and updates configuration

### Event Deduplication (4 tests)
- [ ] Test deduplicates events by event_id
- [ ] Test allows duplicate events without event_id
- [ ] Test filters out ConversationStateUpdateEvent
- [ ] Test handles events arriving in rapid succession

### Confirmation Flow (8 tests)
- [ ] Test shows confirmation prompt for ActionEvent with confirmationRequired=true
- [ ] Test disables confirm button while isSubmitting=true
- [ ] Test keeps reject button enabled while isSubmitting=true
- [ ] Test sends "approve" message on confirm click
- [ ] Test sends "reject" message on reject click
- [ ] Test includes rejection reason from textarea
- [ ] Test clears pending action after approval/rejection
- [ ] Test enforces 30-second timeout (isSubmitting → false)

### Toast Notifications (5 tests)
- [ ] Test shows toast on system message
- [ ] Test shows toast on error message
- [ ] Test debounces toasts (600ms window)
- [ ] Test prevents duplicate toasts within debounce window
- [ ] Test toast content matches message

### Input Field Behavior (5 tests)
- [ ] Test sends message on Enter key
- [ ] Test inserts newline on Shift+Enter
- [ ] Test clears input after sending message
- [ ] Test disables send button while isSubmitting=true
- [ ] Test trims whitespace from messages

### Scroll Behavior (3 tests)
- [ ] Test scrolls to bottom when new event arrives
- [ ] Test scrolls to bottom when events list changes
- [ ] Test maintains scroll position when user manually scrolls up

### Agent Status Tracking (3 tests)
- [ ] Test sets agentWaitingForConfirmation=true on WAITING_FOR_CONFIRMATION status
- [ ] Test sets agentWaitingForConfirmation=false on RUNNING status
- [ ] Test updates UI based on agent status

### Edge Cases (8 tests)
- [ ] Test handles malformed message content gracefully
- [ ] Test handles events with missing required fields
- [ ] Test handles very long event lists (>1000 events)
- [ ] Test handles rapid-fire events (stress test)
- [ ] Test handles null/undefined in event data
- [ ] Test prevents XSS in user-generated content
- [ ] Test handles concurrent send operations
- [ ] Test memory cleanup on component unmount

### Event Rendering - Advanced (10 tests)
- [ ] Test ObservationEvent with expand/collapse
- [ ] Test ObservationEvent with images
- [ ] Test MessageEvent with multiple images
- [ ] Test MessageEvent with reasoning content
- [ ] Test ActionEvent with HIGH security risk badge
- [ ] Test ActionEvent with null action (edge case)
- [ ] Test SystemPromptEvent with tool count
- [ ] Test AgentErrorEvent with stack traces
- [ ] Test PauseEvent rendering
- [ ] Test Condensation event rendering

## Acceptance Criteria

- [ ] All 52+ test cases pass
- [ ] Coverage for App.tsx increases from 30% to at least 70%
- [ ] Tests use @testing-library/react best practices
- [ ] Tests use @testing-library/user-event for interactions
- [ ] Tests verify DOM updates after state changes
- [ ] Tests use proper async/await for async operations
- [ ] CI pipeline runs tests successfully

## Testing Strategy

### Testing useEffect Hooks

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

test('attaches message listener on mount', () => {
  const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

  render(<App />);

  expect(addEventListenerSpy).toHaveBeenCalledWith(
    'message',
    expect.any(Function)
  );
});

test('handles "event" messages', async () => {
  render(<App />);

  act(() => {
    window.postMessage({
      type: 'event',
      data: {
        event_id: '123',
        event_type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      },
    }, '*');
  });

  await waitFor(() => {
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Testing Confirmation Flow

```typescript
import userEvent from '@testing-library/user-event';

test('shows confirmation prompt and handles approval', async () => {
  const user = userEvent.setup();
  const postMessageSpy = vi.fn();
  window.vscode = { postMessage: postMessageSpy };

  render(<App />);

  // Inject action requiring confirmation
  act(() => {
    window.postMessage({
      type: 'event',
      data: {
        event_id: '123',
        event_type: 'action',
        action: { tool: 'BashTool', args: { command: 'rm file.txt' } },
        confirmationRequired: true,
        security_risk: 'HIGH',
      },
    }, '*');
  });

  await waitFor(() => {
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  await user.click(screen.getByText('Approve'));

  expect(postMessageSpy).toHaveBeenCalledWith({
    type: 'approve',
  });
});
```

### Testing Toast Debouncing

```typescript
test('debounces toasts within 600ms window', async () => {
  vi.useFakeTimers();
  render(<App />);

  // Send 3 error messages rapidly
  act(() => {
    window.postMessage({ type: 'error', data: 'Error 1' }, '*');
    window.postMessage({ type: 'error', data: 'Error 2' }, '*');
    window.postMessage({ type: 'error', data: 'Error 3' }, '*');
  });

  // Only first toast should show
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText('Error 1')).toBeInTheDocument();

  // Wait 600ms
  act(() => {
    vi.advanceTimersByTime(600);
  });

  // Now next error can show
  act(() => {
    window.postMessage({ type: 'error', data: 'Error 4' }, '*');
  });

  await waitFor(() => {
    expect(screen.getByText('Error 4')).toBeInTheDocument();
  });

  vi.useRealTimers();
});
```

### Testing Input Behavior

```typescript
test('sends message on Enter, newline on Shift+Enter', async () => {
  const user = userEvent.setup();
  const postMessageSpy = vi.fn();
  window.vscode = { postMessage: postMessageSpy };

  render(<App />);

  const input = screen.getByRole('textbox');

  // Type and press Shift+Enter (should add newline)
  await user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2');
  expect(input).toHaveValue('Line 1\nLine 2');

  // Press Enter (should send)
  await user.type(input, '{Enter}');

  expect(postMessageSpy).toHaveBeenCalledWith({
    type: 'send',
    text: 'Line 1\nLine 2',
  });
  expect(input).toHaveValue(''); // Cleared after send
});
```

### Testing Edge Cases

```typescript
test('handles very long event lists without memory leak', () => {
  render(<App />);

  const initialMemory = performance.memory?.usedJSHeapSize;

  // Send 1000 events
  act(() => {
    for (let i = 0; i < 1000; i++) {
      window.postMessage({
        type: 'event',
        data: {
          event_id: `event-${i}`,
          event_type: 'message',
          message: { role: 'user', content: [{ type: 'text', text: `Message ${i}` }] },
        },
      }, '*');
    }
  });

  const finalMemory = performance.memory?.usedJSHeapSize;
  const memoryIncrease = finalMemory - initialMemory;

  // Ensure memory increase is reasonable (< 50MB for 1000 events)
  expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
});
```

## Impact

- **Medium-high priority**: Largest component with significant complexity
- Currently only 30% tested, leaving 70% of component untested
- Prevents regressions in core UI functionality
- Ensures reliable user interactions
- Improves confidence in state management

## Related Files

- `src/webview-src/components/App.tsx` (699 lines) - Main target
- `src/webview-src/__tests__/App.render.test.tsx` (14 lines) - Keep existing
- `src/webview-src/__tests__/actions.test.tsx` (52 lines) - Keep existing
- `src/webview-src/__tests__/event.rendering.test.tsx` (150+ lines) - Keep existing
- `src/webview-src/__tests__/toasts.test.tsx` (16 lines) - Keep existing

## Related Issues

- Related to #[confirmation-mode-issue] for frontend confirmation testing
- Part of overall test coverage improvement initiative

## Additional Notes

Consider splitting App.tsx into smaller components for better testability:
- `EventList` component (renders events)
- `ConfirmationPrompt` component (already separate)
- `MessageInput` component (input field and send button)
- `Header` component (status, buttons)

This refactoring would make testing easier and improve maintainability, but is out of scope for this issue.
