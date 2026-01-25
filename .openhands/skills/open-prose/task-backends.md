---
role: openhands-task-backends
summary: |
  How to approximate OpenProse's Task tool in OpenHands by using either:
  (1) OpenHands CLI in headless mode, orchestrated via tmux, or
  (2) OpenHands Cloud REST API to start remote agents.

  This document is for execution semantics in OpenHands-Tab only.
see-also:
  - runner.md: OpenHands runner (direct execution, no subagents)
  - prose.md: OpenProse VM semantics (assumes Task tool)
  - https://github.com/OpenHands/OpenHands-CLI
  - https://github.com/OpenHands/OpenHands (openhands/app_server)
---

# Task Backends for OpenProse in OpenHands

OpenProse's `prose.md` spec assumes a **Task tool** that can spawn real subagent runs.
In OpenHands, we currently execute sessions directly (see `runner.md`).

This doc describes two **optional** backends that can approximate the Task tool:

1. **Local CLI backend (tmux + `openhands --headless`)**
2. **Cloud REST backend (OpenHands App Server REST API)**

These backends are intended for a future OpenProse runner enhancement where:

```prose
let x = session "Do work"
```

…can be executed as a separate OpenHands run, returning an output payload that the VM can bind to `x`.

---

## Backend A: Local CLI via tmux (`openhands --headless`)

### When to use

Use this backend when:
- You have the `openhands` CLI installed in the environment
- You want reproducible, scriptable sub-runs
- You can tolerate local sandbox limitations (no cloud isolation)

### Relevant upstream sources

From `OpenHands/OpenHands-CLI`:
- `openhands --headless` flag exists
- `--json` streams JSONL events (only works with `--headless`)

See:
- `README.md` (headless examples)
- `openhands_cli/argparsers/main_parser.py` (flag definitions)

### Basic command

```bash
openhands --headless -t "<task text>"
```

Optional JSONL output:

```bash
openhands --headless --json -t "<task text>"
```

### tmux orchestration pattern

Because OpenHands (this environment) does not expose a native Task tool, you can simulate it by:

1. Creating a dedicated tmux session per OpenProse `session`
2. Running `openhands --headless --json` inside it
3. Redirecting output to a log file
4. Waiting for completion and parsing output

Example:

```bash
# Start a new tmux session that runs a headless OpenHands task
session_name="prose_sess_001"
log="/tmp/${session_name}.jsonl"
TASK='Fix the failing unit tests in packages/agent-sdk-ts'

# -d: detached
# bash -lc: login shell semantics
# Note: we printf %q to safely embed the task string inside the tmux command.

tmux new-session -d -s "$session_name" \
  "bash -lc 'openhands --headless --json -t '"$(printf %q "$TASK")"' > '"$(printf %q "$log")"' 2>&1'"

# Wait until tmux session ends
while tmux has-session -t "$session_name" 2>/dev/null; do sleep 1; done

# Inspect results
cat "$log"
```

### What the OpenProse VM needs to know

To use the CLI backend as a Task tool, the VM needs:

- **Task input**: the session prompt (plus formatted context)
- **An output contract**: how to extract the final answer from JSONL logs
- **A sandbox strategy**:
  - reuse working directory vs isolate per session
  - propagate git state or not
- **Timeout/kill strategy**: when to stop runaway runs

### Minimal viable output contract

In headless JSON mode, the CLI emits JSONL events. The VM can:
- capture all output
- prefer the *final* assistant message, or
- look for a structured summary event if present

(Exact event schema needs to be confirmed in the runner implementation; start with “collect last assistant message”.)

---

## Backend B: Cloud REST API (OpenHands App Server)

### When to use

Use this backend when:
- You want real parallelism (multiple cloud agents)
- You want cloud sandbox isolation per session
- You can authenticate to OpenHands Cloud

### Relevant upstream sources

From `OpenHands/OpenHands`:
- The FastAPI app server lives at `openhands/app_server/`
- REST routes are mounted under `/api/v1` (see `openhands/app_server/v1_router.py`)
- Conversations are managed under `/api/v1/app-conversations` (see `app_conversation_router.py`)

Key endpoints (from router inspection):
- `POST /api/v1/app-conversations` — start a conversation (returns a start-task)
- `POST /api/v1/app-conversations/stream-start` — start and stream updates
- `GET /api/v1/app-conversations/start-tasks/...` — inspect start task(s)
- `GET /api/v1/conversation/{conversation_id}/events` — event retrieval

### High-level flow

To approximate the Task tool with REST:

1. **Start conversation** with a task prompt and settings
2. **Stream events** until completion (or poll)
3. **Extract final output** (last assistant message or structured event)
4. **Return output** to the OpenProse VM as the session result

### What the OpenProse VM needs to know

- **Authentication**: which token/cookie/header is required for cloud
- **Request model**: what fields `AppConversationStartRequest` needs
- **Event streaming**:
  - SSE vs chunked JSON
  - how to detect "done"
- **Result extraction**:
  - find final assistant output
  - or find a well-defined “conversation completed” event

### Minimal viable output contract

For early versions:
- treat the final assistant message content as the session output
- store the full event log as an artifact for debugging

---

## Recommendation (practical)

- **Default today**: `runner.md` direct execution (no subagents)
- **Next step**: add a “Task backend” option to the runner:
  - `task_backend: direct | cli_headless | cloud_rest`
- **Start with CLI backend** first (simpler, fewer auth and schema unknowns)
- Add Cloud REST backend once we standardize a stable REST contract and auth flow

---

## Notes / Caveats

- These backends are *not implemented* yet in OpenHands-Tab; this is guidance for how to do it.
- CLI headless runs may require installing the `openhands` CLI in the environment.
- Cloud REST details depend on the deployed service and authentication scheme.
