# agent-sdk-ts investigation log

## Setup checklist
- Cloned the Python agent-sdk repository (`enyst/agent-sdk`) into `/workspace/agent-sdk` for side-by-side comparison.
- Attempted to clone `agent-sdk-ts` from GitHub for reference; repository prompted for authentication, so the existing package in this monorepo is the working copy.
- Read repository guidelines in `AGENTS.md` and the SDK-specific guidance in `packages/agent-sdk-ts/AGENTS.md`.
- Reviewed `docs/agent-sdk-architecture.md` for the intended TypeScript SDK architecture.

## Initial observations
- `@openhands/agent-sdk-ts` currently exposes conversation, runtime, LLM, tools, and workspace layers aimed at VS Code usage.
- LocalConversation implements an in-process orchestration loop with tools and event logging; RemoteConversation proxies to the agent-server over WebSocket/HTTP.

(Will append detailed gap analysis and follow-up actions as investigation continues.)

## Gaps vs Python agent-sdk (so far)
- **Remote conversation history**: Python `RemoteConversation` fetches existing events via `RemoteEventsList` and appends them to a local cache before streaming new ones. The TS `RemoteConversation.restoreConversation()` only opens WebSockets and never replays past events, so restoring a saved conversation yields an empty UI until new events arrive.
- **WebSocket resend support**: The agent-server supports `resend_all` on the events WebSocket to replay stored events; the TS client never requests it or performs deduplication, so there is no history when reconnecting.

Next steps: investigate how to pull history (HTTP search vs WS resend) without duplicating live events, then update SDK and tests.
- **Missing conversationStarted signal on restore**: LocalConversation emits `conversationStarted` when restoring an ID; RemoteConversation currently just sets `conversationId` and connects, so the extension never re-sends the active ID to the webview after reload.

## Implemented fixes
- Added conversation history replay for remote sessions via REST `/events/search` with pagination and event-type validation.
- Ensured `RemoteConversation` emits `conversationStarted` when restoring or constructed with an ID, clears dedup state per conversation, and deduplicates events using server-provided IDs (covers `resend_all` WS replays and HTTP history fetch).
