# Agent SDK (TypeScript)

## Overview

> Scope: VS Code Extension only — this SDK is intended to run inside VSCode for use of the OpenHands-Tab extension; standalone usage or non‑VS Code API integrations are not in scope.

The `@openhands/agent-sdk-ts` package is a complete TypeScript implementation for building AI agents with OpenHands on VSCode. It provides a runtime layer for agent orchestration, LLM integration, tool execution, workspace management, and full protocol type definitions.

## Architecture

The SDK is organized into seven main layers:

### 1. Conversation Layer (`src/sdk/conversation/`) - Primary API

High-level conversation management with dual-mode support (local vs remote execution):

- **`Conversation()` factory** - Auto-detects mode based on configuration
  - Returns `LocalConversation` when no serverUrl provided
  - Returns `RemoteConversation` when serverUrl is configured
  - Event-driven API with `.on()` listeners for status, events, errors
  - Unified interface for both local and remote agent execution

- **`LocalConversation`** - Event-driven in-process agent execution for VS Code
  - Runs the orchestration loop locally with `EventLog`, `ConversationState`, and configured tools
  - Uses VS Code workspace access via `LocalWorkspace` (no remote workspace support)
  - Emits events: 'status', 'event', 'error', 'conversationStarted', 'terminal'

- **`RemoteConversation`** - WebSocket-based remote agent
  - Connects to OpenHands agent-server via WebSocket
  - Real-time event streaming with auto-reconnect
  - HTTP fallback for message delivery when WebSocket unavailable
  - Exponential backoff retry strategy (1s base, 15s max, 10 retries)

### 2. Context Layer (`src/sdk/context/`)
Prompt extension and skill management:

- **`AgentContext`** - Central structure for managing prompt extensions
  - Manages repository context, runtime context, and conversation instructions
  - Handles system message suffix injection (repo skills)
  - Handles user message suffix injection (knowledge skills)
  - Automatic user skill loading with deduplication
  - Validates unique skill names

- **`Skill`** - Provides specialized knowledge or functionality
  - Loading from markdown files with frontmatter metadata
  - Support for third-party files (.cursorrules, agents.md, AGENTS.md)
  - Three trigger types:
    - **null** (repo skills): Always active, added to system prompt
    - **KeywordTrigger**: Activated when keywords match user message
    - **TaskTrigger**: Activated for specific tasks with user input variables
  - Variable extraction for user input (${variable_name} format)
  - `loadUserSkills()` function to load from ~/.openhands/skills/

Skills are loaded from:
1. `~/.openhands/skills/` - Primary skills directory

### 3. Runtime Layer (`src/sdk/runtime/`)
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


### 4. LLM Integration Layer (`src/sdk/llm/`)
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

### 5. Tool System (`src/tools/`)
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

- **`GlobTool`** - File discovery with glob patterns
  - Glob-style file discovery relative to workspace root
  - Pattern-to-regex translation with sorted results
  - 100-file truncation limit

- **`GrepTool`** - Content search with regex
  - Regex-based content search with optional glob filter
  - Returns matched files sorted by modification time
  - Includes truncation safeguards

- **`BrowserUseTool`** - Browser automation
  - Navigation, clicks, typing, scrolling
  - Page state/content retrieval with optional screenshots
  - Tab management (list, switch, close)
  - Mirrors Python `browser_use` schemas with stubbed execution

- **`PlanningFileEditorTool`** - Restricted file editor for planning
  - View/create/str_replace/insert commands
  - Write operations restricted to `PLAN.md`
  - Read access allowed for all files
  - Mirrors Python planning file editor schema

- **`DelegateTool`** - Sub-agent delegation
  - Spawn sub-agent identifiers
  - Delegate tasks to spawned agents
  - Validates required fields with zod schemas

- **`IntegratedTerminalRunner`** - VS Code terminal integration
  - Execute commands in VS Code integrated terminal
  - Captures stdout/stderr and exit codes
  - Terminal lifecycle management

- **`types.ts`** - Tool type definitions
- **`validation.ts`** - Tool input validation schemas

### 6. Workspace Layer (`src/workspace/`)
File system abstraction:

- **`LocalWorkspace`** - Local file system operations
  - Read/write files with validation
  - Directory traversal with safeguards
  - Path normalization and security checks
  - File metadata and existence checks

### 7. Protocol Types (`src/types/`)
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
│   ├── sdk/                  # SDK core modules
│   │   ├── conversation/     # Conversation layer (primary API)
│   │   │   ├── index.ts      # Conversation() factory
│   │   │   ├── LocalConversation.ts
│   │   │   └── RemoteConversation.ts
│   │   ├── context/          # Context and skills layer
│   │   │   ├── agent-context.ts  # AgentContext class
│   │   │   └── skills/       # Skill system
│   │   │       ├── skill.ts  # Skill class and loading
│   │   │       └── types.ts  # Skill types
│   │   ├── types/            # Protocol types and guards
│   │   ├── runtime/          # Agent runtime and state
│   │   └── llm/              # LLM clients and streaming
│   ├── tools/                # Tool implementations
│   ├── types/                # Additional protocol types
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


Use real newlines in commit messages. Do not include literal \n sequences. For multi-paragraph messages, prefer one of:
- git commit -m 'Subject' -m 'Body paragraph 1' -m 'Body paragraph 2'
- git commit -F message.txt (where message.txt contains actual newlines)
- git commit -m "Subject" && git commit --amend (to open editor and enter newlines)
or alternatives.

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
  console.log('Event:', event.kind); // MessageEvent, ActionEvent, etc.
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
// Local mode - runs the orchestrator in-process against the VS Code workspace
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
  kind: 'MessageEvent',
  source: 'user',
  llm_message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
});

// Query events
const messages = eventLog.list().filter(isMessageEvent);
```

### Using Skills and AgentContext

Skills extend agent capabilities with specialized knowledge and repository-specific instructions:

```typescript
import { AgentContext, Skill } from '@openhands/agent-sdk-ts';

// Create skills manually
const repoSkill = new Skill({
  name: 'coding-standards',
  content: 'Always use TypeScript strict mode and 2-space indentation.',
  trigger: null, // Always active (repo skill)
});

const knowledgeSkill = new Skill({
  name: 'react-patterns',
  content: 'Use functional components with hooks. Prefer composition over inheritance.',
  trigger: { type: 'keyword', keywords: ['react', 'component'] },
});

// Create AgentContext with skills
const agentContext = new AgentContext({
  skills: [repoSkill, knowledgeSkill],
  loadUserSkills: true, // Auto-load from ~/.openhands/skills/
});

// Get system message suffix (includes repo skills)
const systemSuffix = agentContext.getSystemMessageSuffix();

// Augment user message with triggered skills
const userMessage = { role: 'user', content: [{ type: 'text', text: 'How do I create a React component?' }] };
const augmented = agentContext.getUserMessageSuffix(userMessage);
if (augmented) {
  console.log('Triggered skills:', augmented.activatedSkillNames);
  console.log('Additional context:', augmented.content.text);
}

// Use with LocalConversation
const conversation = Conversation({
  settings: { /* ... */ },
  workspaceRoot: '/workspace',
  agentContext, // Pass AgentContext to conversation
});
```

Skills can also be loaded from markdown files:

```typescript
import { Skill, loadUserSkills } from '@openhands/agent-sdk-ts';

// Load a single skill from a file
const skill = Skill.load({ path: '/path/to/skill.md' });

// Load all user skills from ~/.openhands/skills/
const userSkills = loadUserSkills();
```

Skill file format (with frontmatter):

```markdown
---
name: typescript-best-practices
triggers:
  - typescript
  - ts
---

# TypeScript Best Practices

Always enable strict mode and use explicit types for function parameters and return values.
```

## See Also

- [Main README](../../README.md) - Overall project documentation
- [Repository Guidelines](../../AGENTS.md) - Repository-wide development guidelines
- [docs/agent-sdk-architecture.md](../../docs/agent-sdk-architecture.md) - Detailed SDK architecture guide
