# LLM Profiles: Single Source of Truth (Migration Plan)

Bead: `oh-tab-ot3z`

## Goal

Make **LLM Profiles** the single source of truth for provider/model/baseUrl/openaiApiMode/generation params.

Target end-state:
- Users select an LLM via `openhands.llm.profileId`.
- The extension/SDK resolves `profileId` → a full `LLMConfiguration` locally.
- Raw `openhands.llm.*` settings for provider/model/baseUrl/etc are removed (or internal legacy-only during migration).
- Remote mode does **not** send `profileId` to the agent-server; it expands the profile into the server-supported `agent.llm` fields.

## Current Reality (Inventory)

The repo currently supports **two parallel configuration paths**:
- Profiles (`openhands.llm.profileId`, stored as JSON at `~/.openhands/llm-profiles/<id>.json`)
- Raw `openhands.llm.*` settings (provider/model/baseUrl/openaiApiMode/etc)

Key code paths:

### Local mode: LLM client creation
- `packages/agent-sdk-ts/src/sdk/runtime/Agent.ts`
  - `createLlmClientFromSettings()` passes **both** `profileId` and raw `llm.*` fields into `LLMFactory`.
  - If `profileId` is set, `LLMFactory` loads profile config but still allows **overrides** for any fields other than `provider` and `model`.

### Remote mode: conversation start payload
- `packages/agent-sdk-ts/src/sdk/conversation/RemoteConversation.ts`
  - `startNewConversation()` loads `profileId` locally and expands it into `agent.llm` fields (server schema is strict; no `profile_id` sent).
  - Raw `openhands.llm.*` fields still override parts of the profile config (e.g. baseUrl/timeout/etc).

### Persistence: what gets saved/restored
- `packages/agent-sdk-ts/src/sdk/conversation/LocalConversation.ts`
  - `persistLlmConfig()` writes a persisted LLM config for restore.
  - If `profileId` is present it persists that; otherwise it persists provider+model and many raw LLM fields (baseUrl, apiVersion, temperature, token limits, etc).
  - `restorePersistedLlmConfig()` merges persisted raw fields back into `settings.llm` on restore.

### Provider-specific helper clients
- `packages/agent-sdk-ts/src/sdk/runtime/geminiClient.ts`
  - Uses profiles (`gemini-flash-summarizer`) and a preferred provider key (`GEMINI_API_KEY`).
  - Passes `model: profileId` as a placeholder because `LLMConfiguration.model` is currently required by the type, even when `profileId` is present.

### HAL flows (Gemini classifier)
- `src/webview/host/createWebviewMessageHandler.ts`
  - Uses `openhands.hal.llmProfileId` (default `gemini-flash-hal`) to load `{ baseUrl, model }`.
  - Resolves API key via profile key → provider key → global fallback (no `settings.gemini.*` / `settings.llm.provider` fallbacks).

### Tests that assume raw settings
- `tests/e2e/suite/llmSwitching.ts` and `tests/e2e/suite/llmProfiles.ts` currently exercise both:
  - raw `openhands.llm.*` writes
  - and profile selection

## Proposed Migration (Phased)

### Phase 0: Lock in resolver + precedence (no UI removal yet)
- Define a single “effective LLM config” resolver used by:
  - local agent creation (`Agent.ts`)
  - remote conversation payload construction (`RemoteConversation.ts`)
  - any helper clients (summarizers / HAL classifier)
- Explicitly document and test precedence rules.

### Phase 1: Profiles-first behavior (keep raw settings as legacy fallback)
- If `openhands.llm.profileId` is set and resolves:
  - use profile config as the canonical source for provider/model/baseUrl/openaiApiMode and generation params
  - **do not** override these from raw `openhands.llm.*` (except a short allowlist if we decide it is necessary)
- If `profileId` is unset/invalid:
  - fall back to legacy raw `openhands.llm.*` behavior (for migration only)

### Phase 2: Default profile strategy on fresh installs
- Ensure there is always an effective profile selection:
  - seed a deterministic default profile id
  - auto-select based on which provider key is present when possible
  - otherwise select a default and show a clear UI error/CTA to configure a key in Profiles

### Phase 3: Deprecate/remove raw `openhands.llm.*` settings
- Hide raw provider/model/baseUrl/etc from the Settings UI.
- Update docs to only describe profiles-first configuration.
- Update E2E and unit tests to switch via profile selection only.

### Phase 4: Delete legacy code paths
- Remove legacy merge rules and any raw-settings-only behavior.
- Consider a one-time migration for persisted conversation configs (or treat old persisted raw fields as ignorable once profiles are required).

## Open Questions / Decisions Needed

- **Override allowlist:** should any settings remain global (outside profiles) in the final state (e.g. maxIterations is global, but should token budgets/temperature ever be global overrides)?
- **Persistence semantics:** on restore, should we restore the last selected `profileId` only, or also preserve per-conversation overrides (once overrides are removed, this becomes simpler)?
