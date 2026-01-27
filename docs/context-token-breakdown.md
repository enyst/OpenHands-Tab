# Context Token Breakdown (Local Conversations)

When the UI shows `Context: N tokens` in the toolbar or history list, the value comes from the last LLM response usage (`state.values.llm_usage.inputTokens` when available). When `llm_usage` is missing, the UI falls back to the most recent prompt token count in `state.values.stats` — specifically `state.values.stats.usage_to_metrics.agent.lastTokenUsage.promptTokens` (or legacy `last_token_usage.prompt_tokens`), and then `state.values.stats.usage_to_metrics.agent.accumulatedTokenUsage.perTurnToken` (or legacy `accumulated_token_usage.per_turn_token`). These are provider‑reported **prompt tokens**, so they include everything sent in the request: system prompt, tool definitions, user message, and any extended context appended to the user message.

Below is a concrete breakdown from a fresh local conversation (single user message “are you there?”) using **gpt‑5** on **2026‑01‑23**. Token counts were computed with `tiktoken.encoding_for_model('gpt-5')` (maps to `o200k_base`). `gpt-5-nano` resolves to the same tokenizer, so counts are identical.

To reproduce or analyze other conversations, use `scripts/conversation_token_breakdown.py`.

## Example: `Context: 19,756 tokens`

**Provider input tokens** (from `state.json`):

- `inputTokens`: **19,756**

**Breakdown (approximate, `o200k_base`):**

- **Base system prompt** (`SYSTEM_PROMPT`): **2,268**
- **`<REPO_CONTEXT>` block** (repo + user skills that are always‑on): **~9k–13k** (varies by repo + user skills)
- **`<SKILLS>` list** (available skills summary): **323**
- **`<CUSTOM_SECRETS>` block**: **368**
- **“Available tools:” list** appended to the system prompt: **1,450**
- **User message text** (“are you there?”): **4**
- **User environment suffix** (extended content block): **131**
- **Tool schema JSON** (function definitions sent to OpenAI; approximate): **2,696**

The summed components are close to the provider‑reported `inputTokens`; the remaining difference is expected chat‑format/tool‑schema overhead.

### What’s inside `<REPO_CONTEXT>` (per‑skill tokens)

These are the always‑on skills that were included in the system prompt for the example above:

- **`agents`** (repo root `AGENTS.md`): **3,726**
- **`runtime-no-set`** (`.openhands/skills/runtime-no-set.md`): **61**
- **`conversation-persistence`** (`~/.openhands/skills/conversation-persistence.md`): *(varies by user setup)*
- **`local-bd`** (`~/.openhands/skills/local-bd.md`): *(varies by user setup)*
- **`local`** (`~/.openhands/skills/local.md`): *(varies by user setup)*
- **`vscode_local_setup`** (`~/.openhands/skills/vscode_local_setup.md`): *(varies by user setup)*
- **`vscode_remote_setup`** (`~/.openhands/skills/vscode_remote_setup.md`): *(varies by user setup)*
- **`worktree`** (`~/.openhands/skills/worktree.md`): *(varies by user setup)*


## Why the number is high for a simple greeting

Even with a minimal user message, local mode sends a **large system prompt** that includes:

- the full OpenHands base system prompt,
- repo context (AGENTS/CLAUDE/etc files and `.openhands/skills` repo skills),
- user skills from `~/.openhands/skills` that have no trigger (always‑on),
- an “Available tools” summary,
- the **full tool schema JSON** (counted as input tokens by OpenAI),
- and the environment info suffix appended to the latest user message.

This is expected behavior given the current prompt construction. If you want to reduce context tokens, consider:

- removing redundant always‑on skills (e.g., avoid duplicating `AGENTS.md` via `.openhands/skills/repo.md`),
- trimming large skill files,
- or disabling user skills when they aren’t needed.
