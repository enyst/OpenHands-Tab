# Add test coverage for confirmation mode (action approval/rejection)

**Priority**: P1 - High
**Labels**: testing, coverage, feature, confirmation
**Effort**: Medium (1-2 days)

## Problem

Confirmation mode is a **core feature** of the extension that allows users to approve or reject agent actions before execution. Despite its importance, this functionality is **completely untested**.

The confirmation mode involves:
- **Backend**: `ConnectionManager.approveAction()` and `rejectAction()` methods
- **Frontend**: Confirmation prompt UI in `App.tsx`
- **Protocol**: Serializing and sending `UserRejectObservation` messages

Current state:
- ❌ No tests for `approveAction()` method in ConnectionManager
- ❌ No tests for `rejectAction()` method in ConnectionManager
- ❌ No tests for `respondToConfirmation()` private method
- ❌ No tests for confirmation UI interactions in App.tsx
- ❌ No tests for confirmation timeout (30-second limit)
- ❌ No tests for double-submit prevention

## Risk

Without tests, we cannot ensure:
- Approval/rejection messages are formatted correctly
- WebSocket vs HTTP fallback works for confirmations
- UI state management (pending action, isSubmitting) works
- Timeout logic functions properly
- Race conditions don't occur (double-click approval)

## Proposed Solution

Create two test files:

1. **Backend tests**: `src/connection/__tests__/ConnectionManager.confirmation.test.ts`
2. **Frontend tests**: `src/webview-src/__tests__/App.confirmation.test.tsx`

## Tasks

### Backend Tests (ConnectionManager) - 10 tests

#### approveAction() (4 tests)
- [ ] Test sends UserRejectObservation with status="approved"
- [ ] Test uses WebSocket when connected
- [ ] Test falls back to HTTP when WebSocket unavailable
- [ ] Test includes session API key header in HTTP request

#### rejectAction() (4 tests)
- [ ] Test sends UserRejectObservation with status="rejected"
- [ ] Test includes rejection reason if provided
- [ ] Test uses WebSocket when connected
- [ ] Test falls back to HTTP when WebSocket unavailable

#### Error Handling (2 tests)
- [ ] Test handles network errors gracefully
- [ ] Test emits error event on failure

### Frontend Tests (App.tsx) - 12 tests

#### Confirmation Prompt Display (3 tests)
- [ ] Test shows confirmation prompt for ActionEvent with confirmationRequired=true
- [ ] Test displays action details (tool, thought, security risk)
- [ ] Test hides prompt for actions without confirmationRequired

#### Approve Button (3 tests)
- [ ] Test sends "approve" message on confirm click
- [ ] Test disables confirm button while submitting
- [ ] Test clears pending action after approval sent

#### Reject Button (4 tests)
- [ ] Test sends "reject" message on reject click
- [ ] Test includes rejection reason from text input
- [ ] Test keeps reject button enabled while submitting
- [ ] Test clears pending action after rejection sent

#### Timeout Logic (2 tests)
- [ ] Test sets isSubmitting=true when approval sent
- [ ] Test resets isSubmitting=false after 30 seconds

## Acceptance Criteria

- [ ] All 22 test cases pass
- [ ] Backend tests verify correct message serialization
- [ ] Frontend tests verify UI state management
- [ ] Tests cover both WebSocket and HTTP paths
- [ ] Tests verify timeout and race condition handling
- [ ] CI pipeline runs tests successfully

## Testing Strategy

### Backend Test Example

```typescript
describe('ConnectionManager - Confirmation Mode', () => {
  let manager: ConnectionManager;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket();
    manager = new ConnectionManager(mockSettings, mockNotification);
  });

  test('approveAction() sends correct UserRejectObservation', async () => {
    await manager.approveAction();

    const sentMessage = mockWs.getLastMessage();
    expect(sentMessage).toMatchObject({
      status: 'approved',
      message_id: expect.any(Number),
    });
  });

  test('rejectAction() includes reason', async () => {
    await manager.rejectAction('Too risky');

    const sentMessage = mockWs.getLastMessage();
    expect(sentMessage).toMatchObject({
      status: 'rejected',
      user_message: 'Too risky',
    });
  });
});
```

### Frontend Test Example

```typescript
describe('App - Confirmation Flow', () => {
  test('shows confirmation prompt for confirmable action', () => {
    const action: ActionEvent = {
      event_id: '123',
      event_type: 'action',
      action: { tool: 'BashTool', args: { command: 'rm -rf /' } },
      confirmationRequired: true,
      security_risk: 'HIGH',
    };

    render(<App />);
    postMessage({ type: 'event', data: action });

    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  test('sends approve message on confirm click', async () => {
    const postMessageSpy = vi.fn();
    window.vscode = { postMessage: postMessageSpy };

    render(<App />);
    // Set up pending action...

    await userEvent.click(screen.getByText('Approve'));

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'approve',
    });
  });
});
```

## Impact

- **High priority**: Core feature with zero test coverage
- Prevents regressions in critical user-facing functionality
- Ensures security features (action approval) work correctly
- Improves user trust in confirmation workflow

## Related Files

### Backend
- `src/connection/ConnectionManager.ts:212` - `approveAction()` method
- `src/connection/ConnectionManager.ts:216` - `rejectAction()` method
- `src/connection/ConnectionManager.ts:220` - `respondToConfirmation()` private method

### Frontend
- `src/webview-src/components/App.tsx:147` - Confirmation prompt rendering
- `src/webview-src/components/App.tsx:445` - ConfirmationPrompt component
- `src/webview-src/components/App.tsx:88` - Pending action state management

## Related Issues

- Part of overall test coverage improvement initiative
- Critical for security and user confidence
