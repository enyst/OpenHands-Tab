# OpenHands-Tab for AI Agents

Essential information for working with this codebase.

## Prerequisites

- Node.js >= 22 (npm >= 10)
- VS Code >= 1.104


## Quick Commands

```bash
# Install
npm ci

# Build everything (SDK + extension + webview)
npm run build

# Compile TypeScript + Tailwind + webview (faster for development)
npm run compile

# Build webview only
npm run build:webview

# Build Tailwind CSS
npm run build:tailwind

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Type check
npm run typecheck

# Development watch mode
npm run watch

# E2E tests
npm run e2e

# E2E tests against remote agent-server
npm run e2e:agent-server

# Package extension as VSIX
npm run package
```

### Targeted tests

When only specific tests are relevant (e.g., during reviews):

```bash
npx vitest run src/webview-src/__tests__/event.handlers.test.tsx
```

### Dependency security (npm audit)

```bash
npm audit
# This repo generally remediates audit findings via `package.json#overrides`
# (and a regenerated `package-lock.json`), not `npm audit fix`.
npm install
npm audit
```

Note: this repo uses `package.json#overrides` to pin `diff` for `mocha` and `ts-node` to a non-vulnerable version. If you change these dependencies, re-run `npm audit` and ensure the override remains compatible.


### Agent server scripts

```bash
# Start local agent-server (requires AGENT_SDK_DIR environment variable)
AGENT_SDK_DIR=~/repos/agent-sdk npm run agent-server

# Prepare agent-server (first time setup)
AGENT_SDK_DIR=~/repos/agent-sdk npm run agent-server:prepare

# Launch VS Code with extension in dev mode
npm run dev:vscode
```

# Launch extension in VS Code
# Press F5 in VS Code, or:
```bash
code "$(pwd)" --extensionDevelopmentPath="$(pwd)"
```

## Tooling

If tooling is missing in your environment:

- Install Node.js >= 22 (e.g., with nvm: `nvm install 22 && nvm use 22`, or via tarball)
- Ensure `node` and `npm` are on PATH
- For headless Linux (no `$DISPLAY`), run E2E tests under Xvfb: `xvfb-run -a npm run e2e`


## Project Structure
```
OpenHands-Tab/
├── src/                          # Extension source
│   ├── extension.ts              # VS Code entry point
│   ├── __tests__/                # Unit tests (Vitest)
│   ├── conversation/host/        # ConversationManager
│   ├── settings/                 # SettingsManager, adapters
│   │   └── host/                 # Host-side settings
│   ├── sidebar/                  # Activity bar view provider
│   ├── shared/                   # Shared types and utilities
│   ├── webview/                  # Webview host integration
│   │   └── host/                 # Host-side webview logic
│   └── webview-src/              # React webview UI
│       ├── __tests__/            # Webview unit tests
│       ├── components/           # App, EventBlock, InputArea, Header, etc.
│       └── shared/               # Shared webview utilities
├── packages/agent-sdk-ts/        # TypeScript SDK
│   └── src/
│       ├── conversation/         # Conversation API (primary)
│       ├── context/              # AgentContext, Skills
│       ├── runtime/              # Orchestrator, EventLog, State
│       ├── llm/                  # LLM clients (Anthropic, OpenAI)
│       ├── tools/                # Terminal, FileEditor, Browser, Glob, Grep, etc.
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
- For Beads-tracked work: include a PR description section `### Bead` containing the **full contents** of the Beads issue the PR fixes (copy/paste for traceability).

Reviews (do not merge without review):
- Do **not** request OpenHands review via GitHub comments anymore (e.g. `@openhands /codereview-roasted`).
- Request review via **Agent Mail** (mandatory):
  - Requester: send an Agent Mail message to the designated reviewer with the PR link/number and context; set `ack_required=true`.
  - Reviewer: run the OpenHands roasted review locally (via tmux) and reply in-thread with the full output.
- Ensure the GitHub AI reviewers are done (or clearly unavailable):
  - **Gemini-code-assist**: starts automatically upon PR creation; treat it as "one review done" once it has posted two top-level comments and you've checked/resolved its inline threads. Re-trigger with `/gemini review` if needed.
  - **CodeRabbitAI**: only wait if its ETA is <=10 minutes (pending or rate-limited). If it would block longer than that, proceed without it.
    - if you waited for its rate-limit to expire (if it was under 10 minutes), you can re-trigger with `@coderabbitai review`.
- Always read review threads in "Files changed" (bots leave inline comments).
- Right before merging, do a final pass on GitHub to avoid missing late feedback:
  - "Conversation" tab: scan top-level comments (including bots).
  - "Files changed" tab: scan/resolve inline review threads.
  - Checks: confirm OpenHands/Gemini/CodeRabbit aren't still pending (or explicitly waived per the policy above).
- When merging: edit the PR description to append a `### Review` section summarizing the roasted review(s) from the designated reviewer and any back-and-forth/resolution notes, then merge.
- If OpenHands feedback is "truly minor" (e.g., wording/typos/formatting only), you can address it without re-requesting review.
- Merge only when CI is green, review threads are resolved/addressed, and any required branch-protection rules are satisfied.

**Reviewer workflow** (the OpenHands roasted review via tmux):
- Use a clean worktree to avoid clobbering shared branches/uncommitted changes:
  ```bash
  WORKTREE="$(mktemp -d -t oh-tab-review.XXXXXX)"
  git worktree add --detach "$WORKTREE" HEAD
  ```
- If the repo uses `develop` (not `main`) as its default branch, create a local alias so tools that assume `main` don’t explode:
  ```bash
  git -C "$WORKTREE" fetch origin develop
  git -C "$WORKTREE" branch -f main origin/develop
  # Optional: if this fails with "cannot force update the branch 'develop' used by worktree ...",
  # skip it (it just means `develop` is already checked out somewhere else).
  git -C "$WORKTREE" branch -f develop origin/develop
  ```
- Start a named tmux session and capture output to a log file:
  (use the actual PR number, below is just an example)
  ```bash
  SESSION=oh_pr${PR_NUMBER}
  LOG="/tmp/${SESSION}.log"
  rm -f "$LOG"

  tmux new-session -d -s "$SESSION" -n review -c "$WORKTREE"
  tmux pipe-pane -o -t "${SESSION}:0.0" "cat >> $LOG"

  # Run the review (keep it non-headless so the session stays open for follow-ups)
  tmux send-keys -t "${SESSION}:0.0" \
    "GIT_PAGER=cat PAGER=cat LESS=FRX openhands --always-approve -t '/codereview-roasted pr ${PR_NUMBER}'" Enter

  # Optional: strip ANSI while viewing
  tail -f "$LOG" | sed -E 's/\x1B\[[0-9;]*[A-Za-z]//g'
  ```
- When it finishes, you’ll see `Message from Agent` and then `Type your message…` in the log/pane.
- Send follow-ups / re-review requests to the *same* waiting session:
  ```bash
  tmux send-keys -t "${SESSION}:0.0" "Re-review PR ${PR_NUMBER} after latest commits." Enter
  ```
- Stop the session when the PR is merged:
  ```bash
  tmux kill-session -t "$SESSION"
  git worktree remove "$WORKTREE"
  ```
- Pitfalls we hit:
  - You must pass the task with `-t` (positional args are treated as subcommands).
  - If you see `No module named 'fastapi'` on startup, reinstall OpenHands with the missing dependency:
    ```bash
    uv tool install --force --with fastapi openhands==1.6.0
    ```
  - If you see `Item 'rs_…' of type 'reasoning' was provided without its required following item.`:
    - This is typically triggered by OpenAI “Responses API” models (notably GPT-5 / Codex) during long interactive sessions.
    - Workaround: end that tmux session, restart OpenHands, and re-run the review using a non-Responses model (e.g. Claude/Gemini) via the OpenHands Settings screen (system command `SETTINGS`). OpenHands requires a restart for agent-settings changes to take effect.
    - If it still recurs: start from a fresh conversation (do not resume), i.e. kill the tmux session and run the `openhands ... -t '/codereview-roasted pr N'` command again.
    - For debugging: capture `openhands --version`, the “Agent initialized with model: …” line from the session log (`/tmp/${SESSION}.log`), and any LLM completion logs under `~/.openhands/` (if enabled).
  - `--exp` UI is noisy to log/copy (ANSI); `GIT_PAGER=cat` + `PAGER=cat` makes paste-back to Mail much easier.


## SDK Package

When editing `packages/agent-sdk-ts`, rebuild before launching extension:
```bash
npm run build -w @openhands/agent-sdk-ts
```

## Agent Mail (MCP) quick commands

- Server endpoint: `http://127.0.0.1:8765/mcp/` (from `<path-to-mcp-agent-mail-repo>`; start with `scripts/run_server_with_token.sh` or `uv run python -m mcp_agent_mail.cli serve-http`).
- Projects use absolute paths, e.g. `project_key="$(pwd)"` or `project_key="<absolute-path-to-your-project>"`.
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


## OpenProse notes

- OpenProse skill docs are vendored at `OpenHands-Tab/.openhands/skills/open-prose/`.
- The agent-sdk-ts parity program lives at `docs/programs/agent-sdk-ts-upstream-parity.prose`.
- Opening PRs via the OpenHands `create_pr` tool expects:
  - `repo_name`, `source_branch`, `target_branch`, `title`, `body`



## Notes & Conventions

- Use real newlines in commit messages, PR/issue descriptions, and comments. Avoid literal `\n` sequences; write readable Markdown.
