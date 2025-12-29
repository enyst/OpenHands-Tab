# Status Bar Error Messages Audit

This document catalogs all error messages that can appear in the VS Code extension status bar.

## Changes Made

### 1. AgentErrorEvent - Removed from status bar
AgentErrorEvents are sent back to the LLM for self-correction. They should NOT be shown to users in the status bar. Previously, they were truncated to 80 chars and displayed. Now they only:
- Clear the matching pending action
- Reset submission state (re-enable buttons)
- Remain visible in the chat timeline (EventBlock)

### 2. ConversationErrorEvent - Simplified to generic message
Except for `missing_llm_api_key` (which has special handling), all other ConversationErrorEvents now show: **"Conversation error occurred."**

Full error details remain available in the chat timeline.

---

## Error Sources Overview

There are two main channels for status bar errors:

1. **`ConversationErrorEvent`** - SDK events shown in status bar (via `showStatusMessage`)
2. **Conversation `'error'` event** - Direct errors shown as banners (via `type: 'error'` message)

Additionally, there are some webview-specific errors from HAL and image attachments.

---

## 1. ConversationErrorEvent (from SDK)

These are emitted by the Agent and appear in both the chat timeline AND status bar.

### Location: `packages/agent-sdk-ts/src/sdk/runtime/Agent.ts`

| Code | Message Template | Source |
|------|-----------------|--------|
| `restore_pending_confirmation_failed` | "Could not restore pending confirmation: {reason}. Context: {detail}" | Agent.restorePendingConfirmation() |
| `max_iterations_exceeded` | "Agent reached the maximum iteration limit ({N}). You can increase this limit in Settings > OpenHands > Conversation > Max Iterations and continue the conversation." | Agent.run() |
| `missing_llm_api_key` | "Missing API key for LLM provider '{provider}'" | LLM initialization |
| `llm_model_not_configured` | "LLM model is not configured" | LLM initialization |
| `llm_request_failed` | "LLM request failed ({status}): {message}" | LLM request errors |
| `missing_fetch_api` | "Global fetch API is unavailable in this runtime" | Tool execution |
| `terminal_shell_missing` | (ENOENT for /bin/bash or cmd.exe) | Terminal tool |
| (debug mode only) | "Debug event emission failed: {message}" | Debug event errors |
| (debug mode only) | "Debug event emission failed for tool call: {message}" | Debug tool call errors |

### Location: `packages/agent-sdk-ts/src/sdk/conversation/LocalConversation.ts`

| Code | Message Template | Source |
|------|-----------------|--------|
| `restore_failed` | "Failed to restore conversation: {error}" | LocalConversation.restoreConversation() |

### Current UI Handling

In `src/webview-src/components/app/useConversationEvents.ts`:

```typescript
} else if (isConversationErrorEvent(event) && event.code === 'missing_llm_api_key') {
  showStatusMessage('error', 'Missing API key. Set it in LLM Profiles.', { autoDismiss: true, ... });
}
```

**Note:** Only `missing_llm_api_key` has special handling. All other ConversationErrorEvents are shown in the timeline but NOT the status bar.

---

## 2. Conversation 'error' Event (Banner Errors)

These go directly to the status bar banner via `{ type: 'error', error: rendered }`.

### Location: `packages/agent-sdk-ts/src/sdk/conversation/LocalConversation.ts`

| Message Template | Source |
|-----------------|--------|
| "Persistence is not configured; starting fresh session" | LocalConversation.restoreConversation() |
| "{error.message}" (from restore) | LocalConversation.restoreConversation() catch |

### Location: `packages/agent-sdk-ts/src/sdk/conversation/RemoteConversation.ts`

| Message Template | Source |
|-----------------|--------|
| "Cannot connect to agent-server at {url}. Is the server running? {errorMsg}" | startNewConversation() / restoreConversation() |
| "Timed out connecting to agent-server at {url}. Is the server running?" | WebSocket handshake timeout |
| "Disconnected from agent-server. Reconnect retries exhausted." | Max reconnect retries exceeded |
| "Cannot pause: no active conversation. Start a new conversation first." | pause() |
| "Cannot resume: no active conversation. Start a new conversation first." | resume() |
| "Cannot {approve/reject}: no active conversation." | respondToConfirmation() |
| "Failed to pause conversation (HTTP {status}): {info}" | pause() HTTP error |
| "Failed to resume conversation (HTTP {status}): {info}" | resume() HTTP error |
| "Failed to {approve/reject} action (HTTP {status}): {info}" | respondToConfirmation() HTTP error |
| "Failed to send message (HTTP {status}): {info}" | sendUserMessage() HTTP error |
| "Failed to fetch conversation history (HTTP {status}): {info}" | fetchHistoryPage() HTTP error |
| "Invalid event payload: {json}" | WebSocket message parse |
| (raw error message) | Various catch blocks |

---

## 3. Webview-Specific Errors

### HAL Errors (`src/webview-src/components/app/useHalFlow.ts`)

| Message Template | Source |
|-----------------|--------|
| "HAL audio disabled for this conversation: {message}" | handleHalFlowError() |
| "{message}" (various HAL errors) | handleHalFlowFatalError() |

### Image Attachment Errors (`src/webview-src/components/app/useInlineImageAttachments.ts`)

| Message Template | Source |
|-----------------|--------|
| "Failed to paste image: {reason}" | pasteHandler catch |

---

## Proposed One-Liner Summaries

For the bead **oh-tab-odqs** (P4: Status bar errors), we should replace raw/truncated messages with semantic summaries:

### Server Connection Errors

| Raw Message | Proposed Summary |
|-------------|------------------|
| "Cannot connect to agent-server at http://... Is the server running? fetch failed" | "Cannot connect to server" |
| "Timed out connecting to agent-server at http://..." | "Server connection timed out" |
| "Disconnected from agent-server. Reconnect retries exhausted." | "Server disconnected (retries exhausted)" |

### Conversation State Errors

| Raw Message | Proposed Summary |
|-------------|------------------|
| "Cannot pause: no active conversation..." | "No conversation to pause" |
| "Cannot resume: no active conversation..." | "No conversation to resume" |
| "Cannot approve: no active conversation." | "No conversation active" |
| "Failed to pause conversation (HTTP 500): ..." | "Pause failed (server error)" |

### LLM Errors

| Raw Message | Proposed Summary |
|-------------|------------------|
| "Missing API key for LLM provider 'anthropic'" | "Missing API key. Set it in LLM Profiles." (already handled) |
| "LLM request failed (400): ..." | "LLM request failed (400)" |
| "LLM request failed (429): ..." | "Rate limited. Try again shortly." |
| "LLM request failed (401): ..." | "Auth failed. Check API key." |

### Agent Limit Errors

| Raw Message | Proposed Summary |
|-------------|------------------|
| "Agent reached the maximum iteration limit (50)..." | "Max iterations reached. Increase in Settings." |

---

## Implementation Notes

### Files to Modify

1. **`src/shared/errorSummaries.ts`** - Add new pattern matching for server/conversation errors
2. **`src/webview-src/components/app/useConversationEvents.ts`** - Expand ConversationErrorEvent handling
3. **`src/webview-src/components/app/useHostMessages.ts:456-461`** - Add summarization for `type: 'error'` messages

### Key Principle

- Status bar shows **short, actionable summary** (max ~60 chars)
- Full error details remain in:
  - Chat timeline (EventBlocks)
  - Output channel logs
