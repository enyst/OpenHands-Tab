---
name: Implement LocalConversation
about: Implement full agent orchestration in LocalConversation (currently a stub)
title: 'Implement LocalConversation for in-process agent execution'
labels: 'enhancement, agent-sdk'
---

## Problem

`LocalConversation` (`packages/agent-sdk-ts/src/conversation/LocalConversation.ts`) is currently a stub that only emits events without actual agent orchestration. It does not execute LLM calls, tools, or run the agent loop.

## Current Behavior

When `serverUrl` is undefined, `Conversation()` factory returns a `LocalConversation` instance that:
- Accepts `sendUserMessage()` calls
- Emits a `MessageEvent`
- Does NOT call LLM
- Does NOT execute tools
- Does NOT orchestrate agent behavior

Essentially it's just an EventEmitter shell.

## Expected Behavior

`LocalConversation` should provide full agent execution within VS Code without requiring an external agent-server:

1. **LLM Integration**: Use `AgentOrchestrator` + `LLMFactory` to call LLM with streaming
2. **Tool Execution**: Execute tools (`TerminalTool`, `FileEditorTool`, `TaskTrackerTool`, `BrowserTool`) using `LocalWorkspace`
3. **Agent Loop**: Implement conversation loop with iteration limit from settings
4. **Event Emission**: Emit proper events (MessageEvent, ActionEvent, ObservationEvent, etc.)
5. **State Management**: Track conversation state, tool calls, confirmations
6. **VS Code Integration**: Use VS Code terminal for command output, SecretStorage for credentials

## Architecture

LocalConversation should integrate existing SDK components:

```
LocalConversation (EventEmitter)
  ├─> AgentOrchestrator (orchestrator.runChat)
  ├─> EventLog (track all events)
  ├─> ConversationState (status, iteration count)
  ├─> SecretRegistry (API keys from VS Code)
  ├─> LocalWorkspace (file operations)
  └─> Tools (Terminal, FileEditor, TaskTracker, Browser)
```

## Implementation Checklist

- [ ] Add AgentOrchestrator instance to LocalConversation
- [ ] Create LLM client using LLMFactory from settings
- [ ] Implement agent loop in sendUserMessage():
  - [ ] Call orchestrator.runChat() with conversation history
  - [ ] Handle streaming LLM responses
  - [ ] Execute tool calls (TerminalTool, FileEditorTool, etc.)
  - [ ] Emit proper events (ActionEvent, ObservationEvent)
  - [ ] Respect max_iterations from settings
  - [ ] Handle confirmation flow (pause/approve/reject)
- [ ] Emit terminal events for command output
- [ ] Add proper error handling and recovery
- [ ] Write tests for LocalConversation
- [ ] Update documentation to remove stub warnings

## VS Code-Bound Nature

Note: Even when fully implemented, LocalConversation will remain **VS Code-bound**:
- Uses `vscode.SecretStorage` for API keys
- Uses `IntegratedTerminalRunner` for terminal integration
- Uses VS Code workspace APIs

"Local mode" means: running agent in VS Code without external agent-server
NOT: standalone CLI agent

## Workaround (Current)

Until implemented, users should use `RemoteConversation` with agent-server running on localhost:

```typescript
const conversation = Conversation({
  serverUrl: 'http://localhost:3000', // local agent-server
  settings,
  workspaceRoot
});
```

## References

- Current stub: `packages/agent-sdk-ts/src/conversation/LocalConversation.ts`
- AgentOrchestrator: `packages/agent-sdk-ts/src/runtime/AgentOrchestrator.ts`
- Tools: `packages/agent-sdk-ts/src/tools/`
- Documentation: `docs/agent-sdk-architecture.md`
