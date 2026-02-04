# LLM Profiles (Spec)

This document specifies the intended behavior for **LLM Profiles** in both the **Conversation View** (selection/use) and the **LLM Profiles View** (create/edit/manage).

Related docs:
- `docs/llm_profiles_sot_migration.md` (single-source-of-truth migration plan)
- `docs/settings_prd.md` (settings + storage overview)

## Goals

- **Profiles are the single source of truth** for the main agent LLM configuration (provider/model/baseUrl and generation params).
- The user can **switch profiles at runtime**; the change applies to the **next** LLM request only (in-flight requests keep streaming).
- Profiles are a **local-only** concept in VS Code:
  - Local mode: the SDK resolves `profileId` locally and uses it directly.
  - Remote mode: the extension resolves `profileId` locally and **expands** it into server-supported `agent.llm` fields (do not send `profile_id` until the agent-server supports it).

Non-goals:
- “Freezing”/diffing the agent state (`diff_from_deserialized`, etc.) is explicitly out of scope.

## Storage

### Profile files

- Profiles live on disk as JSON files under:
  - `~/.openhands/llm-profiles/<profileId>.json`
  - Source of truth constant: `packages/agent-sdk-ts/src/sdk/llm/profiles.ts` (`DEFAULT_LLM_PROFILES_DIR`)
- `profileId` is the **filename stem** and must be a safe filename:
  - Non-empty, trimmed
  - No path separators
  - Regex: `^[a-zA-Z0-9._-]+$`
  - Validator: `assertValidProfileId()` in `packages/agent-sdk-ts/src/sdk/llm/profiles.ts`

### Secrets (API keys)

API keys are not stored in settings.json or in profile JSON files. They live in VS Code `SecretStorage`.

SecretStorage keys:
- **Provider-global keys** (shared defaults; shown in Settings under `OpenHands: Secrets`):
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENROUTER_API_KEY`
  - `LITELLM_API_KEY`
  - `GEMINI_API_KEY`
- **Per-profile override key** (only when “Override for this profile” is enabled):
  - `openhands.llmProfileApiKey.<profileId>`

Key precedence for a given profile:
1. If “Override for this profile” is enabled and `openhands.llmProfileApiKey.<profileId>` exists, use it.
2. Otherwise use the provider-global key for the profile’s selected provider (e.g. `LITELLM_API_KEY` when provider is `litellm_proxy`).
3. If no key is available, the request should fail with a clear user-facing error and a hint to set a key in `OpenHands: Secrets` or via the profile override UI.

Important: key selection is **provider-driven**, not “model-family-driven”. For example, if provider is `litellm_proxy`, do **not** use `OPENAI_API_KEY` even if the model string starts with `gpt-`.

## Profile schema (UI-facing)

Profiles are edited via form fields (no raw JSON editing in the UI).

Core fields:
- Name (maps to `profileId`; required; immutable after create)
- Provider (e.g. `openai`, `anthropic`, `openrouter`, `litellm_proxy`, `gemini`)
- Model (string; required)
- Base URL (optional; defaults by provider)
- OpenAI API Mode (OpenAI only): `chat_completions` | `responses`
- Generation params: temperature, topP, topK, maxInputTokens, maxOutputTokens, timeoutSeconds
- OpenAI reasoning (when applicable): reasoningEffort, reasoningSummary
- Headers (advanced; optional)

## Conversation View (select + apply)

### Selection behavior

- The profile dropdown shows the **currently selected** `profileId`.
- When the user selects a profile from the dropdown:
  - The dropdown closes immediately.
  - The selected item (checkmark + optional gear icon while open) updates to the newly selected `profileId`.
  - The next LLM request uses the newly selected profile’s resolved configuration.

### Default profile selection (startup)

On startup (and when reading settings), if `openhands.llm.profileId` is unset/blank/invalid, the extension should auto-select a deterministic default profile id and persist it to global settings.

Current selection heuristic (best-effort):
1. If any per-profile override key exists in SecretStorage (`openhands.llmProfileApiKey.<profileId>`), prefer that profile (so users who set a profile key in the UI land on that profile next time).
2. Else, if a provider-global key exists (e.g. `OPENAI_API_KEY`), pick a sensible default profile for that provider.
3. Else fall back to a deterministic baseline (currently `sonnet-45`).

### Runtime switching semantics

- Switching profiles mid-conversation:
  - Local mode: applies to the **next** LLM request (no interruption of in-flight streaming).
  - Remote mode: applies when you start a **new conversation** (the agent-server does not currently support mid-conversation LLM switching).

### Usage IDs vs Profile IDs

- **`usageId` identifies the component that is spending tokens**, not the profile.
  - Example usage buckets: `agent` (main assistant), `tool-summarizer`, `file-diff-summarizer`, etc.
- **`profileId` selects the LLM configuration** (provider/model/base URL/generation params).
- In OpenHands-Tab, the **main agent usageId is fixed to `agent`**:
  - Switching profiles does **not** change the usageId.
  - This keeps the main agent’s totals stable across profile changes (one bucket for the agent).
- Usage IDs are **not user-configurable in settings**; component-specific usage IDs are set in code.

### Consistency requirement (critical)

These three must always match (no “snap back to session default”):
1. The profileId displayed in Conversation View (closed dropdown).
2. The profile item that is checkmarked when the Conversation View dropdown is open.
3. The profileId that is actually used to resolve the LLM configuration for the next request.

## LLM Profiles View (create + edit + manage)

### Profile picker + form

- The view includes a profile selector (dropdown) with:
  - Existing profiles
  - “New Profile…” (clears the form and enables editing the Name field)
- When editing an existing profile:
  - The Name (`profileId`) field is disabled (since it is the filename).
  - Saving changes must keep the form showing the **same profile** that was edited (do not switch to some default profile after Save).

### Save / Close (dirty-state)

- The view tracks whether the form has unsaved changes (“dirty”).
  - Clean:
    - Save is disabled/inactive
    - Cancel button label reads “Close”
  - Dirty:
    - Save is enabled
    - Cancel button label reads “Cancel” (and cancels changes + closes)

### Delete (when present)

- Deleting a profile:
  - Must prompt for confirmation (in-webview modal matching `ConfirmationPrompt` styling).
  - On confirm:
    - Deletes `~/.openhands/llm-profiles/<profileId>.json`
    - Deletes the per-profile override secret `openhands.llmProfileApiKey.<profileId>` (provider-global keys remain untouched)
    - Refreshes the list and loads another existing profile (or “New Profile…” state if none exist)

### Provider key UX

- If a provider-global key exists for the selected provider, the UI should “recognize” it and show a simple indicator (e.g. green check), with an option to “Override for this profile”.
- The UI should not display env-var-like key names as primary user text (avoid “Using OPENAI_API_KEY” style messaging in the main flow).

## Error handling + logging

User-facing errors (EventBlocks / status bar) should include:
- HTTP status + provider error message (e.g. “invalid model ID”)
- A short actionable hint when possible (e.g. “Check the profile’s provider/model or set the provider API key in OpenHands: Secrets.”)

User-facing errors should **not** include internal diagnostic fields like:
- effectiveBaseUrl / effectiveProvider / effectiveModel
- inline/apiKey markers
- mode=local / profileId echoing unless it helps the user (prefer a simple “Selected profile: <id>” if needed)

Internal diagnostics (full request payload, effective resolution details) belong in:
- Debug logs / Output channel gated behind debug/verbosity settings (e.g. `openhands.agent.debug`, `openhands.devBridge.enabled`, `openhands.logging.verbosity`), not in normal UI error blocks.
