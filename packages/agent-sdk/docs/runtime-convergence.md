# TypeScript runtime convergence notes

This document records the current ownership and boundary decisions for the TypeScript OpenHands runtime shared across:

- `OpenHands-Tab/packages/agent-sdk`
- `smolpaws`
- `enyst-smolpaws`

It exists so these repos converge on one runtime story before any larger repository move.

## Canonical ownership model

`OpenHands-Tab/packages/agent-sdk` is the canonical source for the shared TypeScript runtime.

That scope includes:

- agent orchestration primitives
- local and remote conversation clients
- persistence helpers
- local and remote workspace clients
- built-in tool definitions
- remote wire-format expectations used by TypeScript clients

The application repos should treat this package as shared infrastructure rather than maintain their own long-lived forks of runtime behavior.

### Application roles

- `smolpaws`
  - WhatsApp ingress and container-side execution shell
  - consumes the published SDK package in `container/agent-runner`
- `enyst-smolpaws`
  - GitHub ingress plus Fastify runner / agent-server shell
  - consumes the published SDK package and implements the remote server surface expected by `RemoteConversation` and `RemoteWorkspace`
- `OpenHands-Tab/packages/agent-sdk`
  - canonical TypeScript runtime and client contract source

## Boundary decision for phase 1

The runtime is not being forced into a full VS Code extraction before convergence work lands.

Phase 1 keeps the current optional VS Code integration in place while converging the shared remote contract and browser story. New work should avoid introducing additional hard VS Code assumptions into the runtime layer.

## Audited VS Code-coupled touchpoints

These are the main places where the shared runtime still knows about VS Code-specific behavior:

1. `src/sdk/runtime/SecretRegistry.ts`
   - optional `SecretStorage` integration
   - optional `require("vscode")` access path
2. `src/tools/IntegratedTerminalRunner.ts`
   - VS Code pseudoterminal integration
   - spawn fallback for non-VS Code execution
3. `src/workspace/LocalWorkspace.ts`
   - optional VS Code workspace-root discovery
4. `src/sdk/conversation/LocalConversation.ts`
   - constructor paths that accept VS Code secret storage through `SecretRegistry`

These touchpoints are intentionally tracked here so they can be extracted behind adapters later if they start blocking packaging or runtime reuse.

## Current distribution path

The current shared distribution path is the published package:

- package name: `@smolpaws/agent-sdk`

Near-term convergence should keep the package release flow centered on this repo and version the consuming apps against that published package, rather than introducing repo-local copies of runtime logic.

## What still remains after this document

This note does not finish convergence by itself. The main open items after ownership/boundary clarification are:

- replacing the stubbed browser-use path with one real browser implementation
- finishing the remaining remote agent-server parity edges in `enyst-smolpaws`
- deciding whether the repositories should eventually be consolidated once interfaces stop moving
