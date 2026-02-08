# OpenHands Agent SDK (TypeScript) - Architecture Guide

## Overview

The `@smolpaws/agent-sdk` package is a complete TypeScript implementation for building AI agents with OpenHands on VSCode. This document provides an architectural overview and implementation guide for the SDK.

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
│                 (VS Code Extension only)                 │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────────────┐
│              @smolpaws/agent-sdk                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │      Conversation Layer (Primary API)            │    │
│  │  Conversation() Factory │ Local │ Remote         │    │
│  │  Event-driven API (.on) │ Auto-reconnect         │    │
│  └──────────────┬──────────────────────────────────┘    │
│                 │                                         │
│  ┌──────────────┴──────────────────────────────────┐    │
│  │         Runtime Layer (Orchestration)            │    │
│  │  LLMStreamer │ EventLog │ State │ Locks   │    │
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

## Layer 0: Conversation (Primary API)

The conversation layer provides the main API for the SDK, wrapping all lower layers into an event-driven interface for managing agent conversations.

### Conversation Factory

**Purpose**: Entry point for creating conversation instances with automatic mode detection.

**Files**: `src/sdk/conversation/index.ts`

**API**:
```typescript
function Conversation(options: ConversationOptions): ConversationInstance;

interface ConversationOptions {
  serverUrl?: string;              // undefined = local mode, string = remote mode
  settings: OpenHandsSettings;     // LLM config, tools, confirmation policy, etc.
  workspaceRoot: string;           // Workspace directory path
  conversationId?: string;         // Optional: restore existing conversation
}

interface ConversationInstance {
  // Event listeners (EventEmitter pattern)
  on(event: 'status', listener: (status: 'online' | 'offline' | 'connecting') => void): void;
  on(event: 'event', listener: (event: Event) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'conversationStarted', listener: (id: string) => void): void;
  on(event: 'terminal', listener: (event: BashEvent) => void): void;

  // Conversation control
  startNewConversation(): Promise<void>;
  restoreConversation(id: string): Promise<void>;
  sendUserMessage(text: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;

  // Action confirmation
  approveAction(): Promise<void>;
  rejectAction(reason: string): Promise<void>;

  // Configuration
  setSettings(settings: Partial<OpenHandsSettings>): void;

  // Connection management (remote mode)
  reconnect(): void;
  disconnect(): void;

  // Status
  getStatus(): 'online' | 'offline' | 'connecting';
  getConversationId(): string | undefined;

  // Cleanup
  removeAllListeners(): void;
}
```

### LocalConversation

**File**: `src/sdk/conversation/LocalConversation.ts`

**Purpose**: In-memory agent execution within VS Code without an external agent-server.

**Status**: Local execution path that runs the full agent loop directly inside VS Code using `LLMStreamer`, built-in tools, and `LocalWorkspace`.

**Features**:
- Runs agent orchestration locally using `LLMStreamer`
- EventEmitter-based event dispatching
- Manages tool execution with `LocalWorkspace`
- Terminal events for VS Code integrated terminal
- Full conversation state management
- **Conversation persistence** - save and restore conversations using `FileStore`
- No external server required (but still VS Code-bound)

**Persistence Support**:
LocalConversation supports persistent conversations through the `persistenceDir` or `persistence` options. When configured, all events and state are automatically saved to disk and can be restored later. See [Persistence](#persistence) section for details.

**Note**: LocalConversation remains **VS Code-bound** (uses VS Code SecretStorage, IntegratedTerminalRunner, etc.). "Local mode" means running the agent in VS Code without an external server, not running as a standalone CLI.

### RemoteConversation

**File**: `src/sdk/conversation/RemoteConversation.ts`

**Purpose**: WebSocket-based connection to OpenHands agent-server.

**Features**:
- WebSocket connection to `/sockets/events/{conversation_id}`
- Real-time event streaming
- HTTP fallback for message delivery
- Automatic reconnection with exponential backoff
- Runtime session API key authentication
- Conversation lifecycle management via REST API

**Connection Strategy**:
```
Primary: WebSocket
  ├─ Real-time bidirectional communication
  ├─ Server pushes events as they occur
  └─ Client sends messages instantly

Fallback: HTTP POST
  ├─ Used when WebSocket is unavailable
  ├─ POST /api/conversations/{id}/events
  └─ Ensures message delivery

Reconnection:
  ├─ Exponential backoff (1s base, 15s max)
  ├─ Up to 10 retries
  └─ Status events: 'connecting' → 'online'
```

**Usage Example**:
```typescript
const conversation = Conversation({
  serverUrl: 'http://localhost:3000',
  settings: {
    llm: { model: 'claude-sonnet-4-20250514' },
    secrets: {
      runtimeSessionApiKey: 'sk_session_xxx',
      llmApiKey: process.env.ANTHROPIC_API_KEY,
    },
  },
  workspaceRoot: '/workspace',
});

conversation.on('status', (status) => {
  console.log('Connection:', status);
});

conversation.on('event', (event) => {
  if (isActionEvent(event)) {
    console.log('Agent action:', event.tool_name);
  }
});

await conversation.startNewConversation();
await conversation.sendUserMessage('Install npm dependencies');
```

**REST API Integration**:
// Start conversation
POST /api/conversations
{
  agent: {
    llm: { model, api_key, ... },
    tools: ['terminal', 'file_editor', 'task_tracker'],
    workspace: { type: 'local', working_directory: '/workspace' }
  },
  confirmation_policy: { type: 'NeverConfirm' },
  max_iterations: 50
}

// Control conversation
POST /api/conversations/{id}/pause
POST /api/conversations/{id}/run

// Confirmation
POST /api/conversations/{id}/events/respond_to_confirmation
{ accept: true }  // or { accept: false, reason: "..." }
```

### Mode Detection Logic

The `Conversation()` factory automatically selects the implementation:

```typescript
export function Conversation(options: ConversationOptions): ConversationInstance {
  if (options.serverUrl) {
    return new RemoteConversation(options);
  } else {
    return new LocalConversation(options);
  }
}
```

### Event-Driven Architecture

Both implementations extend Node.js `EventEmitter` for consistent event handling:

**Event Types**:
1. **status** - Connection/execution state
   - Values: `'online'` | `'offline'` | `'connecting'`
   - Emitted on: connection changes, pause/resume

2. **event** - Agent events
   - Type: `Event` (MessageEvent, ActionEvent, ObservationEvent, etc.)
   - Emitted on: every agent event (streaming)

3. **error** - Error notifications
   - Type: `Error`
   - Emitted on: connection errors, execution errors

4. **conversationStarted** - New conversation created
   - Type: `string` (conversation ID)
   - Emitted on: successful conversation creation

5. **terminal** - Terminal events (local mode only)
   - Type: `BashEvent` (BashCommand, BashOutput, BashExit)
   - Emitted on: command execution, output, completion

## Layer 1: Context (Prompt Extension)

The context layer manages prompt extensions through skills and agent context, enabling dynamic injection of repository-specific guidelines, knowledge-based enhancements, and runtime information into agent prompts.

### AgentContext

**Purpose**: Central structure for managing all prompt extensions and contextual inputs that shape how the system interprets user requests.

**Files**: `src/sdk/context/agent-context.ts`

**Key Responsibilities**:
- Manage repository context, runtime context, and conversation instructions
- Inject system message suffixes (repo skills)
- Inject user message suffixes (knowledge skills)
- Automatically load and deduplicate user skills
- Validate unique skill names

**API**:
```typescript
class AgentContext {
  constructor(params?: {
    skills?: Skill[];
    systemMessageSuffix?: string;
    userMessageSuffix?: string;
    loadUserSkills?: boolean;  // Default: false
  });

  // Get system message suffix with repo skill content
  getSystemMessageSuffix(options?: {
    secretNames?: string[];
    llmModel?: string | null;
    llmModelCanonical?: string | null;
    llmProvider?: string | null;
    llmBaseUrl?: string | null;
  }): string | null;

  // Augment user message with triggered skills
  getUserMessageSuffix(
    userMessage: Message,
    skipSkillNames?: string[]
  ): { content: TextContent; activatedSkillNames: string[] } | null;
}
```

**Usage Example**:
```typescript
import { AgentContext, Skill } from '@smolpaws/agent-sdk';

// Create context with skills
const context = new AgentContext({
  skills: [
    new Skill({
      name: 'repo-guidelines',
      content: 'Use TypeScript strict mode.',
      trigger: null, // Always active
    }),
  ],
  loadUserSkills: true,
  systemMessageSuffix: 'Current date: 2025-01-15',
});

// Get system suffix (includes repo skills)
const systemSuffix = context.getSystemMessageSuffix({ llmModel: 'gpt-4', llmProvider: 'openai' });
// Returns: "## repo-guidelines\n\nUse TypeScript strict mode.\n\nCurrent date: 2025-01-15"

// Augment user message
const userMessage = {
  role: 'user',
  content: [{ type: 'text', text: 'How do I use React hooks?' }]
};
const augmented = context.getUserMessageSuffix(userMessage);
// Returns an object like { content: { type: 'text', text: '...' }, activatedSkillNames: ['some-skill'] }
```

### Skill

**Purpose**: Provides specialized knowledge or functionality that can be activated based on triggers.

**Files**: `src/sdk/context/skills/skill.ts`, `src/sdk/context/skills/types.ts`

**Key Responsibilities**:
- Load skills from markdown files with frontmatter metadata
- Support third-party files (.cursorrules, agents.md/AGENTS.md, CLAUDE.md, GEMINI.md) with truncation and vendor gating
- Match triggers against user messages
- Extract variables from skill content (${variable_name} format)
- Load user skills from ~/.openhands/skills/

**Skill Types**:

1. **Repo Skills** (trigger: null)
   - Always active, added to system prompt
   - Used for repository-specific guidelines and coding standards
   - Example: .cursorrules, coding standards

2. **Knowledge Skills** (KeywordTrigger)
   - Activated when keywords match user message
   - Used for domain-specific knowledge injection
   - Example: "react" keyword triggers React best practices

3. **Task Skills** (TaskTrigger)
   - Activated for specific tasks with user input variables
   - Can request user input if variables are missing
   - Example: /refactor task with ${target_file} variable

**API**:
```typescript
class Skill {
  name: string;
  content: string;
  trigger: TriggerType; // null | KeywordTrigger | TaskTrigger
  source: string | null;
  inputs: InputMetadata[];

  constructor(params: {
    name: string;
    content: string;
    trigger: TriggerType;
    source?: string | null;
    inputs?: InputMetadata[];
  });

  // Load skill from markdown file
  static load(params: {
    path: string;
    skillDir?: string | null;
    fileContent?: string | null;
  }): Skill;

  // Match trigger in message
  matchTrigger(message: string): string | null;

  // Extract variables (${var}) from content
  extractVariables(): string[];

  // Check if skill requires user input
  requiresUserInput(): boolean;
}

// Load all user skills
function loadUserSkills(): Skill[];
```

**Usage Example**:
```typescript
import { Skill } from '@smolpaws/agent-sdk';

// Create skill manually
const skill = new Skill({
  name: 'react-hooks',
  content: 'Use functional components with hooks. Avoid class components.',
  trigger: { type: 'keyword', keywords: ['react', 'hooks'] },
});

// Load from file
const fileSkill = Skill.load({ path: '/path/to/skill.md' });

// Match trigger
const trigger = skill.matchTrigger('How do I use React hooks?');
// Returns: 'react'

// Extract variables
const contentWithVars = 'Refactor ${target_file} to use ${pattern}';
const vars = new Skill({
  name: 'refactor',
  content: contentWithVars,
  trigger: { type: 'task', triggers: ['/refactor'] },
}).extractVariables();
// Returns: ['target_file', 'pattern']
```

**Skill File Format**:

Skills are loaded from markdown files with YAML frontmatter:

```markdown
---
name: react-best-practices
triggers:
  - react
  - component
---

# React Best Practices

Use functional components with hooks instead of class components.
Prefer composition over inheritance.
```

For task skills with inputs:

```markdown
---
name: refactor-code
triggers:
  - /refactor
inputs:
  - name: target_file
    description: The file to refactor
  - name: pattern
    description: The pattern to apply
---

# Code Refactoring

Refactor ${target_file} using ${pattern} pattern.
```

**AgentSkills format (SKILL.md directories)**:

In addition to legacy single-file markdown skills, skills can also be represented as directories containing a `SKILL.md` file (with strict naming). Skill directories may include resource folders (`scripts/`, `references/`, `assets/`) and an optional `.mcp.json` for MCP server configuration with variable expansion.

**User Skills Loading**:

Skills are automatically loaded from:
1. `~/.openhands/skills/` - Primary skills directory

Third-party files supported (loaded as repo skills; oversized files are truncated with a notice):
- `.cursorrules` → skill name: "cursorrules"
- `agents.md` or `AGENTS.md` → skill name: "agents"
- `CLAUDE.md` → skill name: "claude" (vendor-gated)
- `GEMINI.md` → skill name: "gemini" (vendor-gated)

## Layer 2: Runtime (Orchestration)

The runtime layer coordinates agent execution, manages conversation state, and orchestrates LLM interactions.

### LLMStreamer

**Purpose**: Manages the Conversation using the LLMClient with streaming support.

**Key Responsibilities**:
- Stream chat completions from LLM providers
- Accumulate streamed chunks (text, reasoning, tool calls)
- Update conversation state in real-time
- Return structured responses with usage metrics

**Usage Example**:
```typescript
import { LLMStreamer, LLMFactory } from '@smolpaws/agent-sdk';

const client = await new LLMFactory({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }).createClient();
const streamer = new LLMStreamer(client);

const response = await streamer.runChat({
  systemPrompt: 'You are a code assistant.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Write a hello world function' }] }
  ],
  tools: [/* tool definitions */]
});

console.log(response.message); // Agent's response
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

### Agent (TS SDK)

**Purpose**: Elevates `LLMStreamer` into a full agent loop that mirrors the Python SDK's local execution flow.

**Key Responsibilities**:
- Emit `SystemPromptEvent` up front with tool definitions
- Manage the full step loop (LLM sampling → action selection → tool execution → observation)
- Enforce confirmation policies (`never | always | risky`) and surface `PauseEvent` when waiting for approval
- Pause/resume/cancel runs while keeping `ConversationState` and `EventLog` in sync
- Execute registered tools against `LocalWorkspace` and emit `ObservationEvent` + tool `MessageEvent` payloads

**Usage Example**:
```typescript
import { Agent, EventLog } from '@smolpaws/agent-sdk';

const agent = new Agent({
  settings: {
    llm: { model: 'gpt-4o-mini' },
    agent: {},
    conversation: { maxIterations: 10 },
    confirmation: { policy: 'always' },
    secrets: {},
  },
  tools: [/* ToolDefinition instances */],
  events: new EventLog(),
  workspaceRoot: '/workspace',
});

await agent.run('List files');
// -> ActionEvent + PauseEvent are emitted, then approve:
await agent.approveAction();
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
import { EventLog, isMessageEvent } from '@smolpaws/agent-sdk';

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
import { ConversationState } from '@smolpaws/agent-sdk';

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
import { SecretRegistry } from '@smolpaws/agent-sdk';

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
import { AsyncLock } from '@smolpaws/agent-sdk';

const lock = new AsyncLock();

await lock.acquire(async () => {
  // Critical section - only one execution at a time
  await performCriticalOperation();
});
```

### Persistence

**Purpose**: Enable conversation state and event history to be saved to disk and restored across sessions.

**Files**: `src/sdk/runtime/persistence.ts`

**Key Components**:

#### ConversationPersistence Interface

Defines the contract for persistence implementations:

```typescript
interface ConversationPersistence {
  conversationId: string;
  appendEvent(event: Event): void;
  readEvents(): Event[];
  writeState(state: AgentState): void;
  readState(): AgentState | undefined;
}
```

#### FileStore Implementation

**Purpose**: File-based persistence using JSONL for events and JSON for state.

**Storage Structure**:
```
{rootDir}/
  {conversationId}/
    events.jsonl     # Append-only event log (one JSON object per line)
    state.json       # Latest state snapshot
```

**Default Location**: `.openhands/conversations/` in the current working directory

**Features**:
- **Event Storage**: Append-only JSONL format for efficient event streaming
- **State Snapshots**: JSON format for quick state restoration
- **Corruption Tolerance**: Skips corrupted lines in events.jsonl
- **Error Handling**: Gracefully handles missing or malformed state files
- **Auto-creation**: Automatically creates conversation directories

**API**:
```typescript
class FileStore implements ConversationPersistence {
  constructor(options: FileStoreOptions);
  appendEvent(event: Event): void;
  readEvents(): Event[];
  writeState(state: AgentState): void;
  readState(): AgentState | undefined;
  static listConversations(rootDir?: string): string[];
}

interface FileStoreOptions {
  rootDir?: string;           // Defaults to .openhands/conversations
  conversationId: string;
}
```

**Usage Example**:
```typescript
import { FileStore, EventLog, ConversationState } from '@smolpaws/agent-sdk';

// Create persistence
const persistence = new FileStore({
  rootDir: '/path/to/conversations',
  conversationId: 'conv-123'
});

// Use with EventLog
const eventLog = new EventLog({ persistence });
eventLog.push({
  kind: 'MessageEvent',
  source: 'user',
  llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
});
// Event is automatically persisted to events.jsonl

// Use with ConversationState
const state = new ConversationState({ eventLog, persistence });
state.setValue('iteration', 1);
// State is automatically persisted to state.json

// List all conversations
const conversations = FileStore.listConversations('/path/to/conversations');
console.log(conversations); // ['conv-123', 'conv-456', ...]
```

**Integration with LocalConversation**:

LocalConversation automatically manages persistence when configured:

```typescript
import { LocalConversation } from '@smolpaws/agent-sdk';

// Option 1: Use persistenceDir (FileStore created automatically)
const conversation = new LocalConversation({
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
  persistenceDir: '.openhands/conversations',  // Relative or absolute path
});

await conversation.startNewConversation();
// Conversation state and events are automatically persisted

// Option 2: Provide custom persistence implementation
const customPersistence = new FileStore({
  rootDir: '/custom/path',
  conversationId: 'my-conversation'
});

const conversation2 = new LocalConversation({
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
  persistence: customPersistence,
});
```

**Restoring Conversations**:

```typescript
import { LocalConversation, FileStore } from '@smolpaws/agent-sdk';

// List available conversations
const conversations = FileStore.listConversations('.openhands/conversations');
console.log('Available conversations:', conversations);

// Restore a specific conversation
const conversation = new LocalConversation({
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
  persistenceDir: '.openhands/conversations',
});

conversation.restoreConversation('conv-123');
// Events and state are loaded from disk
// You can continue the conversation from where it left off

await conversation.sendUserMessage('Continue from where we left off');
```

**Restoration Process**:

When restoring a conversation, the system:
1. Reads all events from `events.jsonl`
2. Replays events through EventLog (emitted to listeners)
3. Attempts to restore state from `state.json` snapshot
4. If no snapshot exists, rebuilds state from events
5. Emits 'conversationStarted' event with the conversation ID

**Error Handling**:

The persistence layer handles various error scenarios gracefully:

```typescript
// Corrupted event line - skipped with console.error
// [FileStore] Skipping corrupted event line: <error>

// Corrupted state file - returns undefined, state rebuilt from events
// [FileStore] Could not read or parse state file: <error>

// Missing persistence configuration
conversation.on('error', (err) => {
  console.error('Persistence error:', err);
});

try {
  conversation.restoreConversation('conv-123');
} catch (error) {
  // Handle restoration errors
}
```

**File Format Examples**:

events.jsonl:
```jsonl
{"id":"evt-1","kind":"MessageEvent","source":"user","timestamp":"2025-11-18T10:00:00Z","llm_message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}
{"id":"evt-2","kind":"MessageEvent","source":"agent","timestamp":"2025-11-18T10:00:01Z","llm_message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]}}
{"id":"evt-3","kind":"ConversationStateUpdateEvent","source":"agent","timestamp":"2025-11-18T10:00:02Z","iteration":1}
```

state.json:
```json
{
  "status": "running",
  "iteration": 1,
  "values": {
    "llm_usage": {
      "input": 100,
      "output": 50
    }
  }
}
```

**Attach Persistence After Initialization**:

For advanced use cases, persistence can be attached after EventLog or ConversationState creation:

```typescript
const eventLog = new EventLog();
const state = new ConversationState({ eventLog });

// Later, attach persistence
const persistence = new FileStore({
  rootDir: '.openhands/conversations',
  conversationId: 'conv-123'
});

eventLog.attachPersistence(persistence);
state.attachPersistence(persistence);

// Future events and state changes will be persisted
```

**Custom Persistence Implementation**:

You can implement custom persistence backends by implementing the `ConversationPersistence` interface:

```typescript
import type { ConversationPersistence, AgentState, Event } from '@smolpaws/agent-sdk';

class DatabasePersistence implements ConversationPersistence {
  conversationId: string;

  constructor(conversationId: string, private db: Database) {
    this.conversationId = conversationId;
  }

  appendEvent(event: Event): void {
    this.db.query('INSERT INTO events (conversation_id, data) VALUES (?, ?)',
      [this.conversationId, JSON.stringify(event)]);
  }

  readEvents(): Event[] {
    const rows = this.db.query('SELECT data FROM events WHERE conversation_id = ?',
      [this.conversationId]);
    return rows.map(row => JSON.parse(row.data));
  }

  writeState(state: AgentState): void {
    this.db.query('INSERT OR REPLACE INTO states (conversation_id, data) VALUES (?, ?)',
      [this.conversationId, JSON.stringify(state)]);
  }

  readState(): AgentState | undefined {
    const row = this.db.queryOne('SELECT data FROM states WHERE conversation_id = ?',
      [this.conversationId]);
    return row ? JSON.parse(row.data) : undefined;
  }
}

// Use custom persistence
const persistence = new DatabasePersistence('conv-123', myDatabase);
const conversation = new LocalConversation({
  settings: { /* ... */ },
  persistence,
});
```

## Layer 3: LLM Integration

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

**File**: `src/sdk/llm/anthropic.ts`

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

**File**: `src/sdk/llm/openai-compatible.ts`

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

### Gemini Client

**File**: `src/sdk/llm/gemini.ts`

**Features**:
- Native Google Gemini API integration
- Streaming support
- Tool calling with Gemini format
- Multi-modal support (text and images)
- Token usage tracking

**Supported Models**:
- gemini-2.0-flash-exp
- gemini-1.5-flash
- gemini-1.5-pro
- And other Gemini models via API

### LLM Factory

**File**: `src/sdk/llm/factory.ts`

**Purpose**: Auto-detect provider and create appropriate client.

**Usage Example**:
```typescript
import { LLMFactory } from '@smolpaws/agent-sdk';

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

**File**: `src/sdk/llm/credentials.ts`

**Resolution Order**:
1. Explicit `apiKey` in configuration
2. VS Code SecretStorage (if available)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

## Layer 4: Tool System

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

**Implementation Notes**:
- Tool handlers now expose zod schemas to validate inputs and surface JSON schemas for LLM tool definitions (`src/tools/zod-tool.ts`).
- `Agent` injects tool descriptions into the system prompt so models see name + description context alongside function metadata.


### Tool output truncation and error messages

The SDK keeps tool output readable for the model by truncating **tool result** text before it is sent back to the LLM:

- Shared truncation utility: `src/sdk/runtime/toolResultTruncation.ts`
- Marker: `<response clipped>`
- Limit: 8,000 characters (head + tail)

For **tool error** messages, the SDK aims to match Python behavior: `AgentErrorEvent` is converted into a `role="tool"` message whose text content is the raw error string (no JSON encoding, no truncation).

- Source: `src/sdk/runtime/toolCallErrorEvents.ts`

### TerminalTool

**File**: `src/tools/TerminalTool.ts`

**Capabilities**:
- Execute bash/shell commands
- Working directory management (cwd)
- Optional timeoutMs
- Exit code and stdout/stderr capture

**Usage Example**:
```typescript
import { TerminalTool, LocalWorkspace } from '@smolpaws/agent-sdk';

const workspace = new LocalWorkspace('/workspace');
const terminal = new TerminalTool();
const context = { workspace };

const result = await terminal.execute({
  command: 'npm install',
  cwd: '/workspace/project'
}, context);

console.log(result.stdout);
console.log(result.exit_code);
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
import { FileEditorTool, LocalWorkspace } from '@smolpaws/agent-sdk';

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
import { TaskTrackerTool, LocalWorkspace } from '@smolpaws/agent-sdk';

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
import { BrowserTool, LocalWorkspace } from '@smolpaws/agent-sdk';

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

### BrowserUseTool (browser_use toolset)

**File**: `src/tools/BrowserUseTool.ts`

**Capabilities**:
- Navigation (`browser_navigate`), clicks (`browser_click`), typing (`browser_type`)
- Page state/content retrieval with optional screenshots (`browser_get_state`, `browser_get_content`)
- Scrolling and history (`browser_scroll`, `browser_go_back`)
- Tab management (`browser_list_tabs`, `browser_switch_tab`, `browser_close_tab`)

**Notes**: These tools mirror the Python `browser_use` schemas and share stubbed execution that returns the requested action payload for unit validation.

### DelegateTool

**File**: `src/tools/DelegateTool.ts`

**Capabilities**:
- `spawn` command to initialize sub-agent identifiers
- `delegate` command to assign tasks to previously spawned identifiers
- Validates required fields per command using zod schemas

### GlobTool

**File**: `src/tools/GlobTool.ts`

**Capabilities**:
- Glob-style file discovery relative to the workspace root or provided path
- Simple pattern-to-regex translation, sorted results, 100-file truncation

### GrepTool

**File**: `src/tools/GrepTool.ts`

**Capabilities**:
- Regex-based content search with optional include glob filter
- Returns matched files sorted by modification time with truncation safeguards

### PlanningFileEditorTool

**File**: `src/tools/PlanningFileEditorTool.ts`

**Capabilities**:
- Mirrors Python planning file editor schema (view/create/str_replace/insert commands)
- Enforces write operations against `PLAN.md` while allowing read access to other files
- Supports simple view ranges and inline replacement/insert helpers for plan content

### FinishTool

**File**: `src/tools/FinishTool.ts`

**Capabilities**:
- Signal that the agent has completed its task and should stop the current run
- Optional message parameter to describe why the agent is finished

**Usage Example**:
```typescript
import { FinishTool, LocalWorkspace } from '@smolpaws/agent-sdk';

const workspace = new LocalWorkspace('/workspace');
const finish = new FinishTool();
const context = { workspace };

// Signal completion
const result = await finish.execute({
  message: 'Task completed successfully'
}, context);
```

## Layer 5: Workspace Abstraction

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

## Layer 6: Protocol Types

### Message Types

**File**: `src/sdk/types/index.ts`

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
  kind: string;
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
    kind: 'MessageEvent';
    source: 'agent' | 'user' | 'environment';
    llm_message: Message;
    activated_skills?: string[];
  }
  ```

- **ActionEvent** - Agent tool calls
  ```typescript
  interface ActionEvent extends EventBase {
    kind: 'ActionEvent';
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
    kind: 'ObservationEvent';
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
export const isMessageEvent = (e: Event): e is MessageEvent => e.kind === 'MessageEvent';
export const isActionEvent = (e: Event): e is ActionEvent => e.kind === 'ActionEvent';
export const isObservationEvent = (e: Event): e is ObservationEvent => e.kind === 'ObservationEvent';

// Content type guards
export const isTextContent = (c: Content): c is TextContent => c.type === 'text';
export const isImageContent = (c: Content): c is ImageContent => c.type === 'image';
```

## Integration Patterns

### Pattern 1: VS Code Extension (Primary)

This is the actual pattern used by the OpenHands-Tab extension:

```typescript
import {
  Conversation,
  type ConversationInstance,
  isMessageEvent,
  isActionEvent,
  isObservationEvent
} from '@smolpaws/agent-sdk';
import { isOpenHandsCloudServerUrl } from '../src/shared/cloudServers';
import { getServerCloudApiKeySecretKey } from '../src/auth/serverCloudApiKeys';
import { getServerRuntimeSessionApiKeySecretKey } from '../src/auth/serverRuntimeSessionApiKeys';

// Workspace root selection (multi-root-safe):
// Prefer the workspace folder containing the active editor, fall back only when the workspace has a single folder.
function resolveWorkspaceRoot(): string {
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const folder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  const activeRoot = folder?.uri?.fsPath;
  if (typeof activeRoot === 'string' && activeRoot.trim().length > 0) return activeRoot;

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders.at(0)!.uri.fsPath;

  return process.cwd();
}

// Create conversation (auto-detects local vs remote)
const serverUrl = settings.serverUrl ?? undefined; // undefined = local mode
const cloudKeyInfo = serverUrl ? getServerCloudApiKeySecretKey(serverUrl) : null;
const cloudApiKey = serverUrl && isOpenHandsCloudServerUrl(serverUrl) && cloudKeyInfo?.ok
  ? await context.secrets.get(cloudKeyInfo.secretKey)
  : undefined;
const runtimeKeyInfo = serverUrl ? getServerRuntimeSessionApiKeySecretKey(serverUrl) : null;
const runtimeSessionApiKey = serverUrl && runtimeKeyInfo?.ok
  ? await context.secrets.get(runtimeKeyInfo.secretKey)
  : undefined;

const conversation: ConversationInstance = Conversation({
  serverUrl,
  settings: {
    llm: {
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
    },
    conversation: {
      maxIterations: 50,
    },
    secrets: {
      cloudApiKey,
      runtimeSessionApiKey,
      llmApiKey: await context.secrets.get('openhands.llmApiKey'),
    },
  },
  workspaceRoot: resolveWorkspaceRoot(),
});

// Listen to events
conversation.on('status', (status) => {
  // Update UI connection indicator
  webview.postMessage({ type: 'status', status });
});

conversation.on('event', (event) => {
  // Forward events to webview for rendering
  webview.postMessage({ type: 'event', event });

  // Handle specific event types
  if (isActionEvent(event)) {
    console.log('Agent action:', event.tool_name);
  } else if (isObservationEvent(event)) {
    console.log('Tool result:', event.observation);
  }
});

conversation.on('error', (error) => {
  vscode.window.showErrorMessage(`Agent error: ${error.message}`);
});

conversation.on('conversationStarted', (conversationId) => {
  // Save conversation ID for restoration
  context.workspaceState.update('currentConversationId', conversationId);
});

conversation.on('terminal', (bashEvent) => {
  // In local mode, display bash events in VS Code terminal
  if (bashEvent.type === 'BashOutput' && bashEvent.stdout) {
    terminal.write(bashEvent.stdout);
  }
});

// Start conversation
await conversation.startNewConversation();

// Handle user input from webview
webview.onDidReceiveMessage(async (message) => {
  if (message.type === 'send') {
    await conversation.sendUserMessage(message.text);
  } else if (message.type === 'command') {
    switch (message.command) {
      case 'pause':
        await conversation.pause();
        break;
      case 'resume':
        await conversation.resume();
        break;
      case 'reconnect':
        conversation.reconnect();
        break;
      case 'approveAction':
        await conversation.approveAction();
        break;
      case 'rejectAction':
        await conversation.rejectAction(message.reason);
        break;
    }
  }
});

// Update settings dynamically
settingsWatcher.onDidChange((newSettings) => {
  conversation.setSettings(newSettings);
});

// Cleanup on deactivation
context.subscriptions.push({
  dispose: () => {
    conversation.removeAllListeners();
    conversation.disconnect();
  }
});
```

### Pattern 2: Remote Mode with Local Agent-Server

For VS Code usage without an external server, run agent-server on localhost:

```typescript
import { Conversation, isMessageEvent } from '@smolpaws/agent-sdk';

// Workspace root selection (multi-root-safe):
// Prefer the workspace folder containing the active editor, fall back only when the workspace has a single folder.
function resolveWorkspaceRoot(): string {
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  const folder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  const activeRoot = folder?.uri?.fsPath;
  if (typeof activeRoot === 'string' && activeRoot.trim().length > 0) return activeRoot;

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders.at(0)!.uri.fsPath;

  return process.cwd();
}

// Run agent-server locally: uv run agent-server --host 127.0.0.1 --port 3000 (use 0.0.0.0 only if you need remote access)
const conversation = Conversation({
  serverUrl: 'http://localhost:3000', // connects to local agent-server
  settings: {
    llm: {
      model: 'claude-sonnet-4-20250514',
    },
    secrets: {
      llmApiKey: process.env.ANTHROPIC_API_KEY,
    },
  },
  workspaceRoot: resolveWorkspaceRoot(),
});

conversation.on('event', (event) => {
  if (isMessageEvent(event) && event.source === 'agent') {
    const text = event.llm_message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
    console.log('Agent:', text);
  }
});

await conversation.startNewConversation();
await conversation.sendUserMessage('List files in the current directory');
```

### Pattern 3: Low-Level Orchestration (Advanced)

For advanced use cases requiring direct control:

```typescript
import {
  LLMStreamer,
  LLMFactory,
  EventLog,
  ConversationState,
  SecretRegistry,
  TerminalTool,
  FileEditorTool,
  LocalWorkspace
} from '@smolpaws/agent-sdk';

// Setup
const secrets = new SecretRegistry(context.secrets);
const apiKey = await secrets.get('ANTHROPIC_API_KEY');
const client = await new LLMFactory({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey }).createClient();

const eventLog = new EventLog();
const state = new ConversationState(eventLog);
const streamer = new LLMStreamer(client, { events: eventLog, state });

// Tools
const workspace = new LocalWorkspace('/workspace');
const terminal = new TerminalTool();
const fileEditor = new FileEditorTool();

const toolContext = { workspace, events: eventLog, secrets };

// Execute agent
const response = await streamer.runChat({
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
- [Python SDK Parity Guide](../packages/agent-sdk-ts/docs/python-parity.md) - Detailed comparison with Python SDK
- [PRD](./PRD.md)
- [OpenHands agent-sdk (Python)](https://github.com/OpenHands/software-agent-sdk)
