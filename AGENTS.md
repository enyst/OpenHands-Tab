# OpenHands-Tab for AI Agents

Essential information for working with this codebase.

## Prerequisites

- Node.js 22 LTS (npm >= 10)
- VS Code >= 1.104


## Quick Commands

```bash
# Install
npm ci

# Build everything (SDK + extension + webview)
npm run build

# Run tests
npm test

# Lint
npm run lint

# Type check
npm run typecheck

# Development watch mode
npm run watch

### Targeted tests

When only specific tests are relevant (e.g., during reviews):

```bash
npx vitest run src/webview-src/__tests__/event.handlers.test.tsx
```


# Launch extension in VS Code
# Press F5 in VS Code, or:
```bash
code "$(pwd)" --extensionDevelopmentPath="$(pwd)"
```

## Tooling

If tooling is missing in your environment:

- Install Node 22 (e.g., with nvm: `nvm install 22 && nvm use 22`, or via tarball)
- Ensure `node` and `npm` are on PATH

## Project Structure
```
OpenHands-Tab/
├── src/                          # Extension source
│   ├── extension.ts              # VS Code entry point
│   ├── __tests__/                # Unit tests (Vitest)
│   ├── connection/               # ConnectionManager
│   ├── session/                  # ConversationManager
│   ├── settings/                 # SettingsManager, adapters
│   ├── sidebar/                  # Activity bar view provider
│   └── webview-src/              # React webview UI
│       └── components/           # App, EventBlock, InputArea, etc.
├── packages/agent-sdk-ts/        # TypeScript SDK
│   └── src/
│       ├── conversation/         # Conversation API (primary)
│       ├── context/              # AgentContext, Skills
│       ├── runtime/              # Orchestrator, EventLog, State
│       ├── llm/                  # LLM clients (Anthropic, OpenAI)
│       ├── tools/                # Terminal, FileEditor, etc.
│       └── types/                # Protocol types, guards
├── tests/e2e/                    # E2E tests (Mocha)
├── docs/                         # Documentation
└── media/                        # Icons, built webview assets
```

## Key Files

- `src/extension.ts` - Extension activation, commands
- `src/webview-src/components/App.tsx` - Main webview component
- `packages/agent-sdk-ts/src/conversation/` - Conversation API
- `package.json` - Commands, settings schema, dependencies

## Coding Style

- TypeScript ES2022, 2-space indent, single quotes, trailing semicolons
- React functional components with hooks
- Follow existing ESLint config (`eslint.config.js`)
- Don't edit generated files: `dist/`, `media/webview.js`, `tailwind.gen.css`

## Testing

- Unit tests: Vitest (`npm test`)
- E2E tests: `npm run e2e` (Mocha + @vscode/test-electron)
- Place tests in `__tests__/` directories alongside source

## Commits

Short imperative sentences. Reference issues with `(#123)`.

```bash
# Multi-paragraph commits
git commit -m 'Subject' -m 'Body paragraph'
```

Do not use literal `\n` in commit messages.

## Pull Requests (required checklist)

Before opening or updating a PR:
- Run the basics: `npm test`, `npm run typecheck`, `npm run lint`
- If you changed extension/webview/runtime behavior: `npm run e2e`
- If you changed build tooling or packaging: `npm run build`
- Ensure GitHub CI checks are green on the PR

Reviews (do not merge without review):
- Ask an active agent/human in this project for review (via Agent Mail or GitHub).
- If nobody is available, do **not** merge. Leave the PR open and do other work; re-check Mail later for reviewers.
- Wait for the two GitHub AI reviewers to finish before merging:
  - **CodeRabbitAI**: check its first comment for “pending” or “rate limit exceeded”.
    - If pending: wait.
    - If rate limited: after the cooldown, re-trigger by pushing a small change or commenting `@coderabbitai review` on the PR.
  - **Gemini-code-assist**: generally considered “done” once it has posted two top-level comments, but also review its inline comment threads.
- Always read review threads in “Files changed” (both bots leave inline comments).
- Merge only after you have an explicit approval and all review threads are resolved/addressed.

## SDK Package

When editing `packages/agent-sdk-ts`, rebuild before launching extension:
```bash
npm run build -w @openhands/agent-sdk-ts
```

## Agent Mail (MCP) quick commands

- Server endpoint: `http://127.0.0.1:8765/mcp/` (from `/Users/enyst/repos/mcp_agent_mail`; start with `scripts/run_server_with_token.sh` or `uv run python -m mcp_agent_mail.cli serve-http`).
- Projects use absolute paths, e.g. `project_key="/Users/enyst/repos/oh-tab"`.
- Register/refresh identity: `register_agent(project_key, program, model, name, task_description?, attachments_policy?)`.
- Inbox: `fetch_inbox(project_key, agent_name, include_bodies?, limit?)`; ack with `acknowledge_message(project_key, agent_name, message_id)`.
- Send mail: `send_message(project_key, sender_name, to[], subject, body_md, thread_id?, ack_required?, importance?, attachments?)`.
- File leases: `file_reservation_paths(project_key, agent_name, paths[], ttl_seconds?, exclusive?, reason?)`; release with `release_file_reservations(...)` or renew via `renew_file_reservations(...)`.
- Discover tooling/agents: `resource://projects`, `resource://project/{slug}`, `resource://tooling/directory` (via `resources/read`).


## Integrating with Beads (dependency-aware task planning)

Beads provides a lightweight, dependency-aware issue database and a CLI (`bd`) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging, audit trail, and file-reservation signals. Project: [steveyegge/beads](https://github.com/steveyegge/beads)

Recommended conventions
- **Single source of truth**: Use **Beads** for task status/priority/dependencies; use **Agent Mail** for conversation, decisions, and attachments (audit).
- **Shared identifiers**: Use the Beads issue id (e.g., `oh-tab-123`) as the Mail `thread_id` and prefix message subjects with `[oh-tab-123]`.
- **Reservations**: When starting a `oh-tab-###` task, call `file_reservation_paths(...)` for the affected paths; include the issue id in the `reason` and release on completion.

Typical flow (agents)
1) **Pick ready work** (Beads)
   - `bd ready --json` → choose one item (highest priority, no blockers)
2) **Reserve edit surface** (Mail)
   - `file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true, reason="oh-tab-123")`
3) **Announce start** (Mail)
   - `send_message(..., thread_id="oh-tab-123", subject="[oh-tab-123] Start: <short title>", ack_required=true)`
4) **Work and update**
   - Reply in-thread with progress and attach artifacts/images; keep the discussion in one thread per issue id
5) **Complete and release**
   - `bd close oh-tab-123 --reason "Completed"` (Beads is status authority)
   - `release_file_reservations(project_key, agent_name, paths=["src/**"])`
   - Final Mail reply: `[oh-tab-123] Completed` with summary and links

Mapping cheat-sheet
- **Mail `thread_id`** ↔ `oh-tab-###`
- **Mail subject**: `[oh-tab-###] …`
- **File reservation `reason`**: `oh-tab-###`
- **Commit messages (optional)**: include `oh-tab-###` for traceability

Event mirroring (optional automation)
- On `bd update --status blocked`, send a high-importance Mail message in thread `oh-tab-###` describing the blocker.
- On Mail "ACK overdue" for a critical decision, add a Beads label (e.g., `needs-ack`) or bump priority to surface it in `bd ready`.

Pitfalls to avoid
- Don't create or manage tasks in Mail; treat Beads as the single task queue.
- Always include `oh-tab-###` in message `thread_id` to avoid ID drift across tools.

## Further Reading

- [docs/PRD.md](docs/PRD.md) - Product requirements
- [docs/agent-sdk-architecture.md](docs/agent-sdk-architecture.md) - SDK architecture
- [docs/vscode_local_setup.md](docs/vscode_local_setup.md) - Local development setup
- [packages/agent-sdk-ts/AGENTS.md](packages/agent-sdk-ts/AGENTS.md) - SDK-specific guidelines
