# Workspace API parity gaps

This document summarizes where the TypeScript `@openhands/agent-sdk-ts` workspace interfaces diverge from the Python `agent-sdk` workspace APIs. It focuses on callable interfaces and behaviors for the workspace factory, local workspace, and remote workspace variants.

## Factory and base abstractions
- **Python** exposes a `Workspace` factory that returns a `LocalWorkspace` or `RemoteWorkspace` based on whether a `host` is provided. The factory also accepts an optional `api_key` for remote instances.
- **TypeScript** only exports `LocalWorkspace` and does not provide a factory wrapper or a shared workspace base class. There is no entrypoint that can switch between local and remote implementations or carry shared metadata (e.g., workspace ID, host, API key).

### Missing in TypeScript
- Workspace factory that chooses between local and remote implementations based on configuration.
- Shared base interface for workspace capabilities to allow polymorphic use.
- Support for passing host/API key metadata at construction time.

## Local workspace capabilities
- **Python** `LocalWorkspace` extends a shared base class and supports command execution with timeout handling, file upload/download (modeled as copies), and typed git helpers that resolve paths relative to `working_dir`.
- **TypeScript** `LocalWorkspace` offers path resolution, file read/write/remove/list helpers, directory creation, shell command execution, and simple git status/diff helpers built on shell calls. It does not provide file upload/download or a typed command result that indicates timeouts.

### Missing in TypeScript
- File upload/download helpers to mirror the Python copy-based behavior.
- Consistent command result metadata (e.g., timeout flag) aligned with the Python `CommandResult` model.
- Git change listing that returns structured `GitChange` models rather than raw `git status` output.
- A `working_dir` concept propagated through the base class; the TS implementation only exposes `root` without a shared model.

## Remote workspace support
- **Python** includes a full `RemoteWorkspace` built on `httpx`, plus `RemoteWorkspaceMixin` helpers that implement bash command execution (start + poll), file upload/download over HTTP, and git change/diff retrieval against a remote agent server.
- **TypeScript** currently lacks any remote workspace implementation or mixin utilities, so all operations are local-only.

### Missing in TypeScript
- `RemoteWorkspace` class with host/API key configuration, HTTP client setup, and operation generators.
- Remote command lifecycle (start, poll, timeout handling) aligned with the Python server API.
- Remote file upload/download endpoints and helpers.
- Remote git change and diff retrieval.

## Context management and safety
- **Python** workspaces support the context manager protocol (`__enter__`/`__exit__`) for deterministic cleanup and rely on Pydantic models for path validation and discriminated unions.
- **TypeScript** does not offer context management or a shared discriminated union type for workspace variants; path validation is performed ad hoc in `resolvePath`.

### Missing in TypeScript
- Optional context/cleanup hooks to mirror Python’s context manager semantics.
- Typed discriminators or shared union types for workspace variants.
- Centralized path validation on a base workspace abstraction.
