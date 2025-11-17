# OpenHands Agent SDK (TypeScript) - Architecture Guide

## Overview

The `@openhands/agent-sdk-ts` package is a complete TypeScript implementation for building AI agents with OpenHands on VSCode. This document provides an architectural overview and implementation guide for the SDK.

## Design Philosophy

The SDK follows these core principles:

1. **Layered Architecture** - Clear separation between runtime, LLM, tools, workspace, and protocol types
2. **Streaming-First** - All LLM interactions use streaming for real-time responsiveness
3. **Type Safety** - Complete TypeScript types with runtime validation
4. **Modularity** - Each layer can be used independently or composed together
5. **Extensibility** - Easy to add new LLM providers, tools, and workspace implementations
6. **Testing** - Tests with deterministic fixtures

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│              (VS Code Extension, CLI, etc.)              │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│              @openhands/agent-sdk-ts                     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │         Runtime Layer (Orchestration)            │    │
│  │  AgentOrchestrator │ EventLog │ State │ Locks   │    │
│  └──────────────┬──────────────────────────────────┘    │
│                 │                                         │
│  ┌──────────────┴──────────────┬─────────────────┐      │
│  │      LLM Layer              │   Tools Layer    │      │
│  │  Anthropic │ OpenAI-compat  │  Terminal │ File │      │
│  │  Factory │ Streaming        │  Browser │ Tasks│      │
│  └─────────────────────────────┴─────────────────┘      │
│                 │                                         │
│  ┌──────────────┴──────────────┬─────────────────┐      │
│  │    Workspace Layer          │  Protocol Types  │      │
│  │  LocalWorkspace             │  Message │ Event │      │
│  └─────────────────────────────┴─────────────────┘      │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

## Layer 1: Runtime (Orchestration)

The runtime layer coordinates agent execution, manages conversation state, and orchestrates LLM interactions.

### AgentOrchestrator

**Purpose**: Manages the Conversation using the LLMClient with streaming support.

**Key Responsibilities**:
- Stream chat completions from LLM providers
- Accumulate streamed chunks (text, reasoning, tool calls)
- Update conversation state in real-time
- Return structured responses with usage metrics

**Usage Example**:
```typescript
import { AgentOrchestrator, LLMFactory } from '@openhands/agent-sdk-ts';

const client = await new LLMFactory({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }).createClient();
const orchestrator = new AgentOrchestrator(client);

const response = await orchestrator.runChat({
  systemPrompt: 'You are a code assistant.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Write a hello world function' }] }
  ],
  tools: [/* tool definitions */]
});

console.log(response.message); // Assistant's response
console.log(response.usage);   // Token usage metrics
```

**Internal Flow**:
```
runChat(request)
  ↓
llm.streamChat(request)
  ↓
for each chunk:
  ├─ type: 'text'           → accumulate to message.content
  ├─ type: 'reasoning'      → accumulate to message.reasoning_content
  ├─ type: 'tool_call_delta'→ accumulate to message.tool_calls[]
  ├─ type: 'usage'          → update usage metrics
  └─ type: 'finish'         → finalize response
  ↓
applyStateUpdate(chunk) → updates ConversationState
  ↓
return { message, usage }
```

### EventLog

**Purpose**: Maintains an ordered log of all events in a conversation.

**Key Features**:
- Append-only event storage
- Event filtering and queries
- Serialization for persistence
- Event type-based indexing

**Usage Example**:
```typescript
import { EventLog, isMessageEvent } from '@openhands/agent-sdk-ts';

const eventLog = new EventLog();

// Add events
eventLog.push({
  type: 'MessageEvent',
  source: 'user',
  llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
});

// Query events
const allEvents = eventLog.list();
const messages = allEvents.filter(isMessageEvent);
```

### ConversationState

**Purpose**: Tracks stateful conversation metadata and runtime values.

**State Values Tracked**:
- `agent_status` - Current agent status (running, waiting, paused, etc.)
- `iteration` - Current iteration count
- `llm_stream` - Accumulated LLM streaming text
- `llm_tool_call` - Current tool call ID
- `llm_usage` - Token usage metrics

**Usage Example**:
```typescript
import { ConversationState } from '@openhands/agent-sdk-ts';

const state = new ConversationState(eventLog);

// Set values
state.setValue('agent_status', 'running');
state.setValue('iteration', 5);

// Read snapshot
const snapshot = state.snapshot;
console.log(snapshot.values.agent_status); // 'running'
console.log(snapshot.values.iteration);     // 5
```

### SecretRegistry

**Purpose**: Secure storage and retrieval of sensitive credentials.

**Features**:
- Namespace isolation (per-agent, per-workspace, global)
- Integration with VS Code SecretStorage
- Environment variable fallback
- Type-safe secret access

**Usage Example**:
```typescript
import { SecretRegistry } from '@openhands/agent-sdk-ts';

const secrets = new SecretRegistry(vscodeSecrets);

// SecretRegistry exposes get(name) with env/SecretStorage fallback
const apiKey = await secrets.get('OPENAI_API_KEY');
```

### AsyncLock

**Purpose**: Prevent race conditions in concurrent agent operations.

**Use Cases**:
- Sequential tool execution
- State updates
- File system operations

**Usage Example**:
```typescript
import { AsyncLock } from '@openhands/agent-sdk-ts';

const lock = new AsyncLock();

await lock.acquire(async () => {
  // Critical section - only one execution at a time
  await performCriticalOperation();
});
```

### StuckDetector

**Purpose**: Detect when agents are stuck in unproductive loops.

**Detection Strategies**:
- Idle detection: No events for a configurable threshold (default 30 seconds)
- Actions without observations: Multiple actions without corresponding observation events

**Usage Example**:
```typescript
import { StuckDetector, EventLog } from '@openhands/agent-sdk-ts';

const eventLog = new EventLog();
const detector = new StuckDetector(eventLog, 30_000); // 30 second threshold

const result = detector.evaluate();
if (result.stuck) {
  console.log('Agent appears stuck:', result.reason);
  console.log('Last event:', result.lastEvent);
  // Trigger recovery or intervention
}
```

## Layer 2: LLM Integration

The LLM layer provides streaming clients for various LLM providers with unified interfaces.

### LLM Type System

**Core Types**:
```typescript
interface LLMConfiguration {
  provider?: 'openai' | 'litellm_proxy' | 'openrouter' | 'anthropic';
  model: string;
  baseUrl?: string | null;
  apiKey?: string;
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
  // ... other parameters
}

interface ChatCompletionRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: LLMToolDefinition[];
}

type LLMStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'tool_call_delta'; id: string; name?: string; arguments?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; ... }
  | { type: 'finish'; finishReason?: string };

interface LLMResponse {
  message: Message;
  usage?: { inputTokens?: number; outputTokens?: number; ... };
}

interface LLMClient {
  streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk>;
}
```

### Anthropic Client

**File**: `src/llm/anthropic.ts`

**Features**:
- Native Anthropic Messages API
- Prompt caching support
- Extended thinking mode
- Tool calling with Anthropic format

**Implementation Highlights**:
```typescript
class AnthropicClient implements LLMClient {
  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': this.config.apiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        system: request.systemPrompt,
        messages: convertMessages(request.messages),
        tools: request.tools,
        stream: true
      })
    });

    for await (const chunk of parseSSE(response.body)) {
      yield convertChunk(chunk);
    }
  }
}
```

### OpenAI-Compatible Client

**File**: `src/llm/openai-compatible.ts`

**Supports**:
- OpenAI
- Azure OpenAI
- OpenRouter
- litellm proxy
- Any OpenAI-compatible API

**Features**:
- SSE streaming
- Tool calling with function format
- Retry logic with exponential backoff
- Custom base URLs

### LLM Factory

**File**: `src/llm/factory.ts`

**Purpose**: Auto-detect provider and create appropriate client.

**Usage Example**:
```typescript
import { LLMFactory } from '@openhands/agent-sdk-ts';

// Auto-detects Anthropic by provided model/api key
const client1 = await new LLMFactory({
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: 'sk-ant-...'
}).createClient();

// Explicit provider
const client2 = await new LLMFactory({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-...'
}).createClient();
```

### Credential Management

**File**: `src/llm/credentials.ts`

**Resolution Order**:
1. Explicit `apiKey` in configuration
2. VS Code SecretStorage (if available)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

## Layer 3: Tool System

The tool layer provides agent capabilities for interacting with the environment.

### Tool Interface

**Base Interface**:
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

interface ToolExecutor {
  execute(input: unknown): Promise<ToolResult>;
}
```

### TerminalTool

**File**: `src/tools/TerminalTool.ts`

**Capabilities**:
- Execute bash/shell commands
- Working directory management (cwd)
- Optional timeoutMs
- Exit code and stdout/stderr capture

**Usage Example**:
```typescript
import { TerminalTool, LocalWorkspace } from '@openhands/agent-sdk-ts';

const workspace = new LocalWorkspace('/workspace');
const terminal = new TerminalTool();
const context = { workspace };

const result = await terminal.execute({
  command: 'npm install',
  cwd: '/workspace/project'
}, context);

console.log(result.stdout);
console.log(result.exitCode);
```

### FileEditorTool

**File**: `src/tools/FileEditorTool.ts`

**Operations**:
- write: overwrite file content
- append: append to file content (creates file/dirs as needed)

**Validation**:
- Path validation and workspace boundary enforcement via LocalWorkspace

**Usage Example**:
```typescript
import { FileEditorTool, LocalWorkspace } from '@openhands/agent-sdk-ts';

const workspace = new LocalWorkspace('/workspace');
const fileEditor = new FileEditorTool();
const context = { workspace };

// Write file
await fileEditor.execute({
  path: 'src/hello.ts',
  content: 'export function hello() { return "Hello, world!"; }'
}, context);

// Append content
await fileEditor.execute({
  path: 'src/hello.ts',
  content: '\nexport const x = 1;\n',
  append: true,
}, context);
```

### TaskTrackerTool

**File**: `src/tools/TaskTrackerTool.ts`

**Features**:
- Create tasks with title/notes
- Update title/notes and completed flag; complete action also supported
- List all tasks (no filtering)
- In-memory only (no persistence)

**Usage Example**:
```typescript
import { TaskTrackerTool, LocalWorkspace } from '@openhands/agent-sdk-ts';

const workspace = new LocalWorkspace('/workspace');
const tracker = new TaskTrackerTool();
const context = { workspace };

// Create task
const created = await tracker.execute({
  action: 'create',
  title: 'Implement login page',
  notes: 'Add username/password form'
}, context);

// Update task to mark as completed
await tracker.execute({
  action: 'update',
  id: created.tasks[0].id,
  completed: true
}, context);

// List all tasks
const result = await tracker.execute({ action: 'list' }, context);
console.log(result.tasks);
```

### BrowserTool

**File**: `src/tools/BrowserTool.ts`

**Capabilities**:
- HTTP GET and POST requests
- Response content streaming with size limits
- Automatic URL validation (http/https only)

**Usage Example**:
```typescript
import { BrowserTool, LocalWorkspace } from '@openhands/agent-sdk-ts';

const workspace = new LocalWorkspace('/workspace');
const browser = new BrowserTool();
const context = { workspace };

// Fetch webpage content
const result = await browser.execute({
  url: 'https://example.com',
  method: 'GET',
  maxBytes: 256 * 1024  // 256KB limit
}, context);

console.log(result.status);   // HTTP status code
console.log(result.content);  // Response body
```

### IntegratedTerminalRunner

**File**: `src/tools/IntegratedTerminalRunner.ts`

**Purpose**: Execute commands in VS Code integrated terminal with streaming output.

**Features**:
- Real-time output streaming
- Terminal lifecycle management
- Multiple terminal support
- Command history

## Layer 4: Workspace Abstraction

### LocalWorkspace

**File**: `src/workspace/LocalWorkspace.ts`

**Purpose**: File system operations with validation and security.

**Operations**:
```typescript
interface Workspace {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  listFiles(directory: string): Promise<string[]>;
  resolvePath(path: string): string;
}
```

**Security Features**:
- Path normalization
- Workspace boundary enforcement
- No `..` traversal outside workspace
- Symbolic link validation

## Layer 5: Protocol Types

### Message Types

**File**: `src/types/index.ts`

**Message Structure**:
```typescript
interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: Content[];
  id?: string;
  created_at?: string | number;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

type Content = TextContent | ImageContent;

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  image_urls?: string[];
  detail?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-encoded
  };
}
```

### Event Types

**Event Hierarchy**:
```typescript
interface EventBase {
  id?: string;
  type: string;
  timestamp?: string;
  source?: 'agent' | 'user' | 'environment';
}

type Event =
  | SystemPromptEvent
  | MessageEvent
  | ActionEvent
  | ObservationEvent
  | UserRejectObservation
  | AgentErrorEvent
  | ConversationErrorEvent
  | PauseEvent
  | Condensation
  | ConversationStateUpdateEvent;
```

**Key Event Types**:

- **MessageEvent** - LLM messages (user/assistant)
  ```typescript
  interface MessageEvent extends EventBase {
    type: 'MessageEvent';
    source: 'agent' | 'user' | 'environment';
    llm_message: Message;
    activated_microagents?: string[];
    activated_skills?: string[];
  }
  ```

- **ActionEvent** - Agent tool calls
  ```typescript
  interface ActionEvent extends EventBase {
    type: 'ActionEvent';
    source: 'agent';
    thought: TextContent[];
    action: Record<string, unknown> | null;
    tool_name: string;
    tool_call_id: string;
    tool_call: ToolCall;
    security_risk?: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
  }
  ```

- **ObservationEvent** - Tool execution results
  ```typescript
  interface ObservationEvent extends EventBase {
    type: 'ObservationEvent';
    source: 'environment';
    observation: Record<string, unknown>;
    tool_name: string;
    tool_call_id: string;
    action_id: string;
  }
  ```

### Type Guards

**Runtime Validation**:
```typescript
// Event type guards
export const isEvent = (candidate: unknown): candidate is Event => { /* ... */ };
export const isMessageEvent = (e: Event): e is MessageEvent => e.type === 'MessageEvent';
export const isActionEvent = (e: Event): e is ActionEvent => e.type === 'ActionEvent';
export const isObservationEvent = (e: Event): e is ObservationEvent => e.type === 'ObservationEvent';

// Content type guards
export const isTextContent = (c: Content): c is TextContent => c.type === 'text';
export const isImageContent = (c: Content): c is ImageContent => c.type === 'image';
```

## Integration Patterns

### Pattern 1: VS Code Extension

```typescript
import {
  AgentOrchestrator,
  LLMFactory,
  EventLog,
  ConversationState,
  SecretRegistry,
  TerminalTool,
  FileEditorTool,
  LocalWorkspace
} from '@openhands/agent-sdk-ts';

// Setup
const secrets = new SecretRegistry(context.secrets);
const apiKey = await secrets.get('ANTHROPIC_API_KEY');
const client = await new LLMFactory({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey }).createClient();

const eventLog = new EventLog();
const state = new ConversationState(eventLog);
const orchestrator = new AgentOrchestrator(client, { events: eventLog, state });

// Tools
const workspace = new LocalWorkspace('/workspace');
const terminal = new TerminalTool();
const fileEditor = new FileEditorTool();

const toolContext = { workspace, events: eventLog, secrets };

// Execute agent
const response = await orchestrator.runChat({
  systemPrompt: 'You are a helpful assistant.',
  messages: conversation.messages,
  tools: [
    {
      type: 'function',
      function: {
        name: 'terminal',
        description: 'Execute shell commands',
        parameters: { /* JSON schema */ }
      }
    },
    {
      type: 'function',
      function: {
        name: 'file_editor',
        description: 'Edit files in the workspace',
        parameters: { /* JSON schema */ }
      }
    }
  ]
});

// Handle tool calls
if (response.message.tool_calls) {
  for (const toolCall of response.message.tool_calls) {
    const args = JSON.parse(toolCall.function.arguments);
    let result;

    if (toolCall.function.name === 'terminal') {
      result = await terminal.execute(args, toolContext);
    } else if (toolCall.function.name === 'file_editor') {
      result = await fileEditor.execute(args, toolContext);
    }

    // Add observation event
    eventLog.push({
      type: 'ObservationEvent',
      source: 'environment',
      observation: result,
      tool_name: toolCall.function.name,
      tool_call_id: toolCall.id,
      action_id: response.message.id
    });
  }
}
```

### Pattern 2: Standalone Agent

```typescript
import { AgentOrchestrator, LLMFactory } from '@openhands/agent-sdk-ts';

const client = await new LLMFactory({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY
}).createClient();

const orchestrator = new AgentOrchestrator(client);

async function chat(userMessage: string) {
  const response = await orchestrator.runChat({
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: [{ type: 'text', text: userMessage }] }]
  });

  const text = response.message.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('');

  console.log('Assistant:', text);
  console.log('Tokens:', response.usage);
}

await chat('Hello, who are you?');
```

## Testing Strategy

### Unit Tests

**Location**: `src/__tests__/`

**Coverage**:
- Type guards with valid/invalid samples
- LLM client streaming logic (mocked HTTP)
- Tool validation and execution (isolated)
- State management and updates
- Event log queries

**Example Test**:
```typescript
import { describe, it, expect } from 'vitest';
import { isMessageEvent } from '../types';

describe('Type Guards', () => {
  it('validates MessageEvent', () => {
    const validEvent = {
      type: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }]
      }
    };

    expect(isMessageEvent(validEvent)).toBe(true);
  });
});
```

### Integration Tests

**VS Code Extension Tests**: `tests/e2e/`

**Tests**:
- Full agent conversation flow
- Tool execution in real VS Code environment
- WebSocket event streaming
- Settings and credential management

## Future Enhancements

### Planned Features

1. **Additional LLM Providers**
   - Google Gemini
   - Mistral
   - Cohere

2. **Advanced Tool System**
   - Tool composition and chaining
   - Parallel tool execution
   - Tool result caching

3. **Enhanced State Management**
   - State snapshots and rollback
   - State persistence to disk
   - State diffing and replay

4. **Agent Templates**
   - Pre-configured agent profiles (coding, research, etc.)
   - System prompt templates
   - Tool preset bundles

5. **Performance Optimizations**
   - Streaming response batching
   - Connection pooling
   - Token usage optimization

## References

- [Main README](../README.md)
- [Package AGENTS.md](../packages/agent-sdk-ts/AGENTS.md)
- [Repository Guidelines](../AGENTS.md)
- [PRD](./PRD.md)
- [OpenHands agent-sdk (Python)](https://github.com/All-Hands-AI/agent-sdk)
