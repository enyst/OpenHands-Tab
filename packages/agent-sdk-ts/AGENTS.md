# Agent SDK (TypeScript)

## Overview

The `@openhands/agent-sdk-ts` package is a complete TypeScript implementation for building AI agents with the OpenHands platform. It provides a runtime layer for agent orchestration, LLM integration, tool execution, workspace management, and full protocol type definitions.

This SDK can be used standalone or as part of the OpenHands-Tab VS Code extension.

## Architecture

The SDK is organized into six main layers:

### 1. Conversation Layer (`src/conversation/`) - Primary API

High-level conversation management with dual-mode support (local vs remote execution):

- **`Conversation()` factory** - Auto-detects mode based on configuration
  - Returns `LocalConversation` when no serverUrl provided
  - Returns `RemoteConversation` when serverUrl is configured
  - Event-driven API with `.on()` listeners for status, events, errors
  - Unified interface for both local and remote agent execution

- **`LocalConversation`** - In-memory agent execution (⚠️ STUB - not yet implemented)
  - Intended: Runs agent orchestration locally using EventEmitter
  - Current: Only emits events without actual agent execution
  - No external server required (but still VS Code-bound)
  - Emits events: 'status', 'event', 'error', 'conversationStarted', 'terminal'

- **`RemoteConversation`** - WebSocket-based remote agent
  - Connects to OpenHands agent-server via WebSocket
  - Real-time event streaming with auto-reconnect
  - HTTP fallback for message delivery when WebSocket unavailable
  - Exponential backoff retry strategy (1s base, 15s max, 10 retries)

### 2. Runtime Layer (`src/runtime/`)
Agent execution and state management:

- **`AgentOrchestrator`** - Core orchestration layer that manages LLM streaming, tool calls, and conversation flow
  - Handles streaming chat completions from LLM providers
  - Accumulates text, reasoning content, and tool calls from stream chunks
  - Updates conversation state in real-time
  - Returns structured LLM responses with usage tracking

- **`EventLog`** - Event history and management
  - Maintains ordered log of all events in a conversation
  - Supports event queries and filtering
  - Provides event serialization for persistence

- **`ConversationState`** - Stateful conversation tracking
  - Manages conversation-level state (agent status, iteration count, etc.)
  - Provides snapshot capabilities for state inspection
  - Supports reactive state updates via setValue()
  - Tracks LLM streaming state, tool calls, and usage metrics

- **`SecretRegistry`** - Secure credential management
  - Stores and retrieves sensitive data (API keys, tokens)
  - Provides namespace isolation for different credential scopes
  - Integration with VS Code SecretStorage

- **`AsyncLock`** - Concurrency control
  - Ensures safe sequential access to shared resources
  - Prevents race conditions in async agent operations
  - Queue-based lock acquisition

- **`StuckDetector`** - Agent health monitoring
  - Detects idle agents (no events for threshold time)
  - Detects actions without observations (unproductive tool calls)
  - Configurable threshold (default 30 seconds)
  - Returns structured result with stuck status and reason

### 3. LLM Integration Layer (`src/llm/`)
Streaming LLM clients and configuration:

- **`types.ts`** - Core LLM types and interfaces
  - `LLMConfiguration` - Model, provider, and parameter configuration
  - `ChatCompletionRequest` - Request structure with system prompt, messages, and tools
  - `LLMStreamChunk` - Stream chunk types (text, reasoning, tool_call_delta, usage, finish)
  - `LLMResponse` - Structured response with message and usage
  - `LLMClient` - Interface for streaming chat implementations

- **`anthropic.ts`** - Anthropic Claude client
  - Native streaming support for Claude models
  - Tool calling with Anthropic's API format
  - Prompt caching support
  - Token usage tracking (input, output, cache read/write)

- **`openai-compatible.ts`** - OpenAI-compatible client
  - Supports OpenAI, Azure OpenAI, and other OpenAI-compatible APIs
  - Streaming with SSE parsing
  - Tool calling with function format
  - Retry logic with exponential backoff

- **`factory.ts`** - LLM client factory
  - Auto-detects provider from configuration
  - Creates appropriate client instances
  - Handles credential injection

- **`credentials.ts`** - Credential resolution
  - Loads API keys from environment or secret storage
  - Provider-specific credential handling (OpenAI, Anthropic, AWS)

### 4. Tool System (`src/tools/`)
Agent tool implementations:

- **`TerminalTool`** - Shell command execution
  - Execute bash/shell commands in controlled environments
  - Stream command output
  - Exit code and error handling
  - Working directory management

- **`FileEditorTool`** - File operations
  - Write or append file contents with path validation
  - Args: { path: string; content?: string; append?: boolean }
  - Creates parent directories as needed

- **`TaskTrackerTool`** - Task management
  - Actions: create, update, complete, list
  - Fields: { id, title, notes, completed }
  - In-memory store; returns { tasks }

- **`BrowserTool`** - HTTP web fetching
  - HTTP GET and POST requests
  - Streams response while enforcing maxBytes limit
  - URL validation (http/https only)

- **`IntegratedTerminalRunner`** - VS Code terminal integration
  - Execute commands in VS Code integrated terminal
  - Captures stdout/stderr and exit codes
  - Terminal lifecycle management

- **`types.ts`** - Tool type definitions
- **`validation.ts`** - Tool input validation schemas

### 5. Workspace Layer (`src/workspace/`)
File system abstraction:

- **`LocalWorkspace`** - Local file system operations
  - Read/write files with validation
  - Directory traversal with safeguards
  - Path normalization and security checks
  - File metadata and existence checks

### 6. Protocol Types (`src/types/`)
Complete OpenHands protocol definitions:

- **Message types**: User, assistant, system, tool messages with structured content
- **Event types**: All event variants (MessageEvent, ActionEvent, ObservationEvent, SystemPromptEvent, AgentErrorEvent, ConversationErrorEvent, PauseEvent, Condensation, ConversationStateUpdateEvent)
- **Type guards**: Runtime validation for protocol objects (isEvent, isMessageEvent, isTextContent, etc.)
- **Content types**: Text and image content with proper typing
- **Tool calls**: Structured tool call format matching OpenAI/Anthropic conventions

## Package Structure

```
packages/agent-sdk-ts/
├── src/
│   ├── index.ts              # Main exports
│   ├── browser.ts            # Browser-specific exports
│   ├── conversation/         # Conversation layer (primary API)
│   │   ├── index.ts          # Conversation() factory
│   │   ├── LocalConversation.ts
│   │   └── RemoteConversation.ts
│   ├── types/                # Protocol types and guards
│   ├── runtime/              # Agent runtime and state
│   ├── llm/                  # LLM clients and streaming
│   ├── tools/                # Tool implementations
│   ├── workspace/            # File system abstraction
│   └── __tests__/            # Unit tests
├── dist/                     # Generated bundles (ESM/CJS)
├── tsup.config.ts            # Bundle configuration
├── tsconfig.json             # TypeScript config
└── vitest.config.ts          # Test configuration
```

## Development Commands

### Installation
From the repository root:
```bash
npm install
```

### Building
```bash
# Build ESM/CJS bundles + declaration files
npm run build -w @openhands/agent-sdk-ts

# Or from this directory
npm run build
```

### Testing
```bash
# Run tests
npm test -w @openhands/agent-sdk-ts

# Watch mode for iterative development
cd packages/agent-sdk-ts
npm test -- --watch
```

### Linting
```bash
# Lint with ESLint
npm run lint -w @openhands/agent-sdk-ts

# Auto-fix issues
npm run lint -w @openhands/agent-sdk-ts -- --fix
```

## Coding Guidelines
- Match the repository defaults: TypeScript (ES2022), 2-space indentation, single quotes, and trailing semicolons.
- Keep runtime-facing types colocated with their guards to guarantee parity between compilation and runtime validation.
- The SDK primarily serves the OpenHands VS Code extension, so it is fine to depend on VS Code types or semantics when doing so makes integration simpler.
- Each layer should be independently testable with minimal cross-layer dependencies.

## Testing Notes
- Prefer deterministic fixtures for protocol payloads; add shared mocks under the repository root's `test/__mocks__` folder if they are broadly useful.
- When changing schemas, cover both happy-path parsing and failure states to prevent silent contract drift.
- Test LLM clients with mocked HTTP responses to avoid real API calls.
- Tool tests should use temporary directories and cleanup after execution.

## Release Considerations
- Bump the package version in `package.json` when publishing to npm and run `npm run build -w @openhands/agent-sdk-ts` beforehand.
- After changes land, rebuild the VS Code extension (`npm run build`) to ensure the workspace dependency picks up the updated SDK bundle.
- Ensure all tests pass (`npm test -w @openhands/agent-sdk-ts`) before releasing.
- Update CHANGELOG.md with notable changes.

## Usage Examples

### Using the Conversation API (Primary Pattern)

This is the main API used by the OpenHands-Tab extension:

```typescript
import { Conversation, type ConversationInstance } from '@openhands/agent-sdk-ts';

// Create a conversation (auto-detects local vs remote mode)
const conversation: ConversationInstance = Conversation({
  serverUrl: 'http://localhost:3000', // or undefined for local mode
  settings: {
    llm: {
      model: 'claude-sonnet-4-20250514',
      usageId: 'default-llm',
      temperature: 0.7,
    },
    conversation: {
      maxIterations: 50,
    },
    secrets: {
      llmApiKey: process.env.ANTHROPIC_API_KEY,
    },
  },
  workspaceRoot: '/path/to/workspace',
});

// Listen to events
conversation.on('status', (status) => {
  console.log('Status:', status); // 'online' | 'offline' | 'connecting'
});

conversation.on('event', (event) => {
  console.log('Event:', event.type); // MessageEvent, ActionEvent, etc.
  // Handle different event types with type guards
  if (isMessageEvent(event)) {
    console.log('Message:', event.llm_message);
  } else if (isActionEvent(event)) {
    console.log('Action:', event.tool_name, event.action);
  }
});

conversation.on('error', (error) => {
  console.error('Error:', error);
});

conversation.on('conversationStarted', (conversationId) => {
  console.log('Conversation ID:', conversationId);
});

// Start a new conversation
await conversation.startNewConversation();

// Send a user message
await conversation.sendUserMessage('Write a hello world function');

// Control conversation
await conversation.pause();
await conversation.resume();

// Action confirmation (when agent is waiting)
await conversation.approveAction();
// or
await conversation.rejectAction('Not safe to proceed');

// Clean up
conversation.removeAllListeners();
conversation.disconnect();
```

### Local vs Remote Mode

```typescript
// Local mode - ⚠️ Currently a stub (no actual agent execution)
const localConversation = Conversation({
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
});

// Remote mode - connects to agent-server (RECOMMENDED)
const remoteConversation = Conversation({
  serverUrl: 'http://localhost:3000', // can be localhost or remote
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
});
```
### Creating an LLM Client (Low-Level)

For advanced use cases, you can use the LLM clients directly:

```typescript
import { LLMFactory, LLMConfiguration } from '@openhands/agent-sdk-ts';

const config: LLMConfiguration = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: process.env.ANTHROPIC_API_KEY,
  temperature: 0.7,
};

const client = await new LLMFactory(config).createClient();
```

### Using AgentOrchestrator (Low-Level)

For direct orchestration without the Conversation wrapper:

```typescript
import { AgentOrchestrator } from '@openhands/agent-sdk-ts';

const orchestrator = new AgentOrchestrator(client);

const response = await orchestrator.runChat({
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello!' }] }],
});

console.log(response.message.content);
```

### Working with Events (Low-Level)

```typescript
import { EventLog, isMessageEvent } from '@openhands/agent-sdk-ts';

const eventLog = new EventLog();

// Add events
eventLog.push({
  type: 'MessageEvent',
  source: 'user',
  llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
});

// Query events
const messages = eventLog.list().filter(isMessageEvent);
```

## See Also

- [Main README](../../README.md) - Overall project documentation
- [Repository Guidelines](../../AGENTS.md) - Repository-wide development guidelines
- [docs/agent-sdk-architecture.md](../../docs/agent-sdk-architecture.md) - Detailed SDK architecture guide
