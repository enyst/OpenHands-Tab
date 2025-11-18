# Python parity gaps across SDK layers

This document tracks where the TypeScript `@openhands/agent-sdk-ts` interfaces diverge from the Python `agent-sdk` implementations. It focuses on callable interfaces and behaviors for conversation control, agents, context/skills, event logging, workspace handling, and persistence/event types.

## Workspace APIs
- **Python** exposes a `Workspace` factory that returns `LocalWorkspace` or `RemoteWorkspace` based on a `host` flag and optional `api_key`, building on a shared base with `working_dir` metadata.
- **TypeScript** only exports `LocalWorkspace` with path resolution, file read/write/remove, directory creation, command execution, and simple git helpers; there is no factory or base class.

### Missing in TypeScript
- Workspace factory that selects local vs remote implementations and carries host/API key metadata.
- Shared base interface with a `working_dir` concept to allow polymorphism across workspace types.
- File upload/download helpers and structured git change models mirroring Python’s copy-based behavior.
- Command result metadata (e.g., timeout flags) aligned with Python’s `CommandResult` model.
- Remote workspace implementation with HTTP-backed command lifecycle, file transfer, and git diff/change retrieval.
- Context/cleanup hooks analogous to Python’s context manager support and centralized path validation.

## Conversation interfaces
- **Python** offers a `Conversation` factory that routes to `LocalConversation` or `RemoteConversation`, threading callbacks, persistence directory, conversation ID, max-iteration limits, visualizer choice, stuck detection, and secret injection; conversations manage cleanup and can resume from persisted state.
- **TypeScript** provides a `Conversation` factory that picks `LocalConversation` (in-process) or `RemoteConversation` (WebSocket + HTTP history replay). Local conversations construct a fresh `Agent`, `EventLog`, `ConversationState`, and `SecretRegistry` but lack persistence. Remote conversations handle retries and history paging but expose fewer lifecycle hooks.

### Missing in TypeScript
- Persistence-aware conversation construction (no `persistence_dir` or resume-from-disk semantics).
- Visualizer/stuck-detection hooks and configurable callback stacks for event handling.
- Secret injection on conversations (secrets are always fresh, non-persisted registries).
- Remote conversation parity with Python’s HTTP command/file/git helpers—TS remote mode only proxies chat/events.
- Context manager/cleanup patterns present in Python’s conversations.

## Agent lifecycle
- **Python** `Agent` extends `AgentBase`, injects a system prompt with serialized tool schemas, optionally routes through condensers, enforces confirmation/security via analyzers, and drives `_execute_actions` with pending-action replay and laminar observability hooks. It runs against `LocalConversation` with persisted `ConversationState` and supports both completion and responses APIs.
- **TypeScript** `Agent` builds a local workspace, `EventLog`, `ConversationState`, and `SecretRegistry`, wires optional tools and `AgentContext`, and drives a simple run loop that pushes user messages, streams LLM responses, executes tool calls (with optional confirmation), and updates iteration/usage counters. Error handling records `ConversationErrorEvent` and stops; there is no condenser/security analyzer integration.

### Missing in TypeScript
- Tool schema/security analyzer injection and associated risk-aware validation.
- Condenser pipeline and laminar observability hooks around `step` execution.
- Persistent `ConversationState` restoration and replay of pending actions from disk.
- Dual LLM API support (responses API parity) and fine-grained confirmation policy classes; TS uses a minimal policy enum.

## AgentContext
- **Python** `AgentContext` is a Pydantic model that templates repo skills into a system suffix (`system_message_suffix.j2`), formats triggered knowledge through Jinja templates, enforces duplicate-skill validation, and automatically loads user skills with warnings.
- **TypeScript** `AgentContext` is a simple class that concatenates always-on skills into Markdown blocks, matches triggers by substring, and appends an optional suffix; user skills can be loaded but formatting is plain strings.

### Missing in TypeScript
- Template-driven rendering for system/user suffixes (no Jinja-based formatting or repo-skill templating).
- Structured validation/metadata on context fields via schemas.
- Detailed logging (TS uses console warnings only) and richer trigger matching behaviors.

## Skill loading and triggers
- **Python** `Skill` is a Pydantic model with keyword/task triggers, optional MCP tool metadata, input validation, automatic `/name` trigger addition for task skills, and a `requires_user_input` helper used to append missing-variable prompts.
- **TypeScript** `Skill` mirrors keyword/task/always-on triggers, third-party file aliases, and missing-variable prompt injection, but lacks MCP tool metadata and Pydantic validation; trigger matching is case-insensitive substring search without regex support.

### Missing in TypeScript
- MCP tool configuration on repo skills and validation of structured metadata.
- Centralized validation helpers (`requires_user_input`, `SkillValidationError` parity for nested types).
- Regex-based trigger matching and richer trigger models.

## Event logging and persistence
- **Python** `EventLog` is file-backed (`FileStore`) with index/id mappings, duplicate detection, slice iteration, and on-disk naming conventions (`EVENT_FILE_PATTERN`). Conversations also rely on `EventsListBase`, persistence constants, and `ConversationState.create` to hydrate from disk with optional diff serialization.
- **TypeScript** `EventLog` is in-memory, normalizes IDs/timestamps, broadcasts listeners, and exposes `push`, `list`, and `on` helpers; no disk persistence, indexing, or append safeguards beyond runtime validation.

### Missing in TypeScript
- File-backed storage with deterministic event filenames/indices and duplicate ID protection.
- Persistence constants and diff/serialization helpers for resume/replay flows.
- Secret persistence (`secret_registry`), FIFO locks, and stuck-detection metadata that accompany Python’s state management.

## Event and persistence interface reference
- **Python event classes** (Pydantic models in `openhands.sdk.event`): `SystemPromptEvent`, `ActionEvent`, `ObservationEvent`, `UserRejectObservation`, `MessageEvent`, `AgentErrorEvent`, `TokenEvent`, `PauseEvent`, `Condensation`, `CondensationRequest`, `CondensationSummaryEvent`, and `ConversationStateUpdateEvent`; all extend `Event`/`LLMConvertibleEvent` with `id`, `timestamp`, `source`, and type-specific fields (tool call IDs, thought/reasoning content, summaries, etc.).
- **TypeScript event interfaces** (`src/sdk/types`): mirrors `SystemPromptEvent`, `ActionEvent`, `ObservationEvent`, `UserRejectObservation`, `MessageEvent`, `AgentErrorEvent`, `ConversationErrorEvent`, `PauseEvent`, `Condensation`, and `ConversationStateUpdateEvent` with discriminated `kind` plus optional metadata; lacks `TokenEvent` and condensation request/summary variants.
- **Python persistence helpers**: `EventLog` (file-backed), `EventsListBase` (iteration/index helpers), `persistence_const` (directory and filename patterns), `ConversationState.create` (hydration with max-iteration/stuck-detection metadata), `serialization_diff` (state diffing), `secret_registry` (persistent secrets), and `fifo_lock` (cross-process lock).
- **TypeScript persistence helpers**: in-memory `EventLog`, `ConversationState` (in-memory status/iteration tracking with `attachEventLog`), and `SecretRegistry` (non-persisted secrets); no disk-based storage, diffing, or cross-process locking primitives.
