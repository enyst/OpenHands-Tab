# agent-sdk-ts parity notes

- Read enyst/agent-sdk README for Python SDK goals and local/remote conversation factory behavior.
- Reviewed OpenHands-Tab docs/agent-sdk-architecture.md for expected layers and noted LocalConversation is still stubbed.
- Current TypeScript LocalConversation only emits status/events for user messages; it does not orchestrate agents, run tools, or use LocalWorkspace/LLM clients. Local mode in VS Code therefore cannot execute actions or show terminal events.
- LocalConversation also ignores the VS Code workspace root and lacks confirmation handling/state updates compared to Python Conversation.
- Local tool system exists (TerminalTool, FileEditorTool, TaskTrackerTool) but is unused in conversation flow; Terminal events are never emitted in local mode, unlike Python terminal tool streaming.
- Implemented LocalConversation orchestration that builds LLM requests with tool schemas, runs terminal/file/task tools through LocalWorkspace, and emits both agent events and bash output so the VS Code UI mirrors the Python SDK behavior in local mode.
- Tools prompt sent to the LLM now reuses the Python agent-sdk function-calling suffix (tools/parameters descriptions rendered via the same template) instead of a simplified bullet list.
