---
name: audit
description: >
  AgentSkill: run a repo-specific security audit of the OpenHands-Tab VS Code extension with a focus on
  secret handling, webview/host boundaries, persistence, and logging redaction. Trigger with /audit.
license: MIT
metadata:
  last_updated: "2026-01-17"
  last_reviewed_commit: "1febfa8"
triggers:
  - /audit
---

# OpenHands-Tab Security Audit (AgentSkill)

This is a **repeatable checklist** for an agent to run against *this repository*.

When invoked (e.g. the user types `/audit`), follow the checklist below, inspect the referenced code, and then output a short audit report.

> Repo-specific note: This repo supports AgentSkills-style `SKILL.md` directories, but also uses
> additional OpenHands-specific frontmatter fields like `triggers`. Do not assume every AgentSkills
> client will understand those extra fields.

## Output format (required)

Return a report with:

1. **Scope** (what you inspected)
2. **High-risk findings** (must fix)
3. **Medium/low-risk findings** (should fix)
4. **Good practices already present** (keep)
5. **Suggested follow-ups** (tests, hardening, docs)

**Never include real secret values** in the report (including partial tokens).

Also: **do not paste raw grep output** that might contain secrets into the report. Prefer file paths + line numbers only.

---

## 1) Threat model (repo-specific)

Primary risks for this VS Code extension:

- **Persistence leaks**: secrets written to disk (VS Code settings JSON, profile files, workspace/global state, logs, conversation stores)
- **Logging leaks**: secrets exposed via OutputChannel, debug channels, error strings/stack traces, dev bridge logs, webview console
- **Webview boundary leaks**: host sending secrets to webview (prohibited); user-typed secrets in webview must be sent to host immediately for SecretStorage only and cleared from UI; secrets persisted in webview state or leaked via console
- **Network leaks**: secrets in URLs/query params, secrets sent to wrong host, secrets attached to redirected requests, non-HTTPS when not explicitly intended
- **Webview surface issues**: XSS / unsafe link openers in the webview can turn “user typed secret” into a real credential leak

---

## 2) Inventory (authoritative sources, avoid stale lists)

### A. Provider API key names and SecretStorage keys

**Do not trust hardcoded lists in docs**. Investigate and find the set of provider key names in the codebase.

- Authoritative code: `src/webview/host/handlers/secretHelpers.ts`
  - Enumerate provider → key name mapping (e.g. `getProviderApiKeyName(...)`).
  - Treat *all* provider keys as secrets.

### B. Extension-managed secret keys

- Authoritative code: `src/settings/SettingsManager.ts`, `src/settings/VscodeSettingsAdapter.ts`
  - Enumerate any keys stored via `adapter.storeSecret(...)` / `context.secrets.store(...)`.

---

## 3) Audit checklist (step-by-step, falsifiable)

### A. Confirm secrets are not persisted in VS Code settings

**Check**: no secret values are written via `workspace.getConfiguration().update(...)` (or any other settings persistence).

- Files to inspect:
  - `src/settings/VscodeSettingsAdapter.ts`
  - `src/settings/SettingsManager.ts`
  - `src/extension/secretCommands.ts`

**Pass criteria**:
- All secret writes go through `context.secrets.store(...)` / `context.secrets.delete(...)`.
- Any settings written as “status indicators” are non-sensitive (boolean/marker only) and cannot be used to reconstruct the secret.

**Fail examples**:
- Writing an API key, token, Authorization header, cookie, or full provider config into settings JSON.

### B. Confirm per-server session API keys are scoped to a specific server

**Check**: session keys are not “global”; they must be bound to a specific normalized server URL.

- Files to inspect:
  - `src/auth/serverSessionApiKeys.ts`
  - `src/shared/serverUrls.ts` (normalization rules)
  - `src/extension/secretCommands.ts` (set/migration behavior)

**Pass criteria**:
- The SecretStorage key name includes a stable identifier derived from the normalized server URL (e.g. a hash).
- The normalized URL logic is understood and documented by the audit:
  - `normalizeServerUrl(...)` supports both `http:` and `https:`
  - when no scheme is provided, it defaults to **http for local** (`localhost`, `127.0.0.1`, `::1`) and **https for non-local**
- Migration from any legacy/global key is conservative:
  - do not automatically re-bind a legacy key to an arbitrary configured server without explicit user intent

**Fail examples**:
- A single `openhands.sessionApiKey` applied to whichever server URL is currently configured.
- Storing per-server keys using an unnormalized URL (leading to aliasing or unintended reuse).

### C. Webview/host boundary: minimize secret exposure

**Non-negotiable policy**: the extension host **must never send secret values to the webview**.

**Reality check**: the webview may still *see* a secret if the **user types it into a webview input field**. Treat that as the maximum tolerated exposure, not a convenience.

- Files to inspect:
  - Webview → host request: `src/webview-src/components/app/useLlmProfilesRequests.ts` (`llmProfileApiKeySetRequest` includes `apiKey`)
  - Host handler: `src/webview/host/handlers/llmProfiles.ts` (`handleLlmProfileApiKeySetRequest` stores to `context.secrets`)
  - UI: `src/webview-src/components/LlmProfilesView.tsx`

**Pass criteria**:
- There are **no host→webview messages** that include secret material (API keys, tokens, Authorization headers, cookies).
- Webview does not persist secrets:
  - no `acquireVsCodeApi().setState(...)` storing `apiKey`, headers, or tokens
- On submit:
  - webview sends the key to the host once, host stores it in SecretStorage, and the webview clears local state promptly.
- No logging on either side:
  - webview: no `console.*` printing request payloads that may contain secrets
  - host: no OutputChannel/dev logging of message payloads containing keys

**Fail examples**:
- Host echoes a stored key back to the webview for “display”.
- Webview caches the key in persistent state to “remember” it.

### D. Profile persistence: do not write secrets to disk by default

In this repo, **LLM profiles are persisted to disk** under `~/.openhands/llm-profiles/*.json`.

Secrets can appear in profiles in two ways:

- `apiKeyRef.kind="inline"` (literal secret value) — **high risk**
- `headers` (Authorization, x-api-key, etc.) — **high risk**

Non-secret references are expected to use:

- `apiKeyRef.kind="key"` (reference name resolved via SecretRegistry / SecretStorage / env)

- Files to inspect:
  - Host store wrapper: `src/webview/host/llmProfilesStore.ts`
  - SDK store: `packages/agent-sdk-ts/src/sdk/llm/profiles.ts`
  - Type definition: `packages/agent-sdk-ts/src/sdk/llm/types.ts` (`ApiKeyRef`)

**Check**: profile save paths have a default mode that **excludes secrets**.

**Pass criteria**:
- A save option like `includeSecrets` exists and defaults to `false`.
- When `includeSecrets=false`:
  - `headers` are removed by default.
  - `apiKeyRef.kind="inline"` is removed by default.
  - `apiKeyRef.kind="key"` is preserved (it is a reference name, not the secret value).
- Host-side "load" paths do not send secrets to the webview:
  - if profiles on disk contain inline secrets, host must still strip them before returning profile JSON to the webview.

**Fail examples**:
- Persisting literal API keys or Authorization headers into profile JSON by default.
- Host sending inline secrets/headers to the webview as part of `llmProfileLoadResponse`.

### E. Logging & error handling: assume redaction is imperfect

**Rule**: the primary defense is **do not log secrets at all**. Redaction is a backstop.

Also: **do not treat allowlists as a security boundary unless enforced in code**. In this repo, `allowed-tools` is parsed for AgentSkills parity but is not used to restrict tool execution.

- Files to inspect:
  - Output channel masking: `src/extension/devBridgeLogger.ts` (`createMaskedOutputChannel`)
  - Debug JSON channel masking: `src/extension/debugJsonOutputChannel.ts`
  - Structured safe logging: `src/shared/safeStringify.ts`
  - Secret-value masking: `src/shared/maskSecrets.ts`

**Checks**:
1. All extension-host logging surfaces run through masking utilities.
2. Any errors posted to OutputChannel / webview / UI are sanitized:
   - do not include request headers, Authorization, cookies, or full config objects.
3. Webview-side logging is clean:
   - no `console.*` printing request payloads that may contain secrets.

**Audit technique**:
- Search for risky logging sites:
  - `console.(log|warn|error)` in both `src/` and `src/webview-src/`
  - direct `outputChannel.append/appendLine/replace`
  - `JSON.stringify(...)` used in logs
- When you find one, trace whether it flows through `maskSecretsInText(...)` and/or `safeStringify(...)`.

**Fail examples**:
- Logging the full webview message payload of `llmProfileApiKeySetRequest`.
- Throwing/printing errors that embed headers or config with inline secrets.

### F. Network requests: keep secrets out of URLs and off the wrong host

**Checks**:
- No code constructs URLs containing secrets (`token=`, `api_key=`, `key=`, `authorization=`).
- Secrets are sent via headers, not query params.
- Ensure Authorization / session headers are only attached to the intended host:
  - audit for redirect behavior and whether headers are preserved across redirects.

**Repo-specific note**:
- This repo supports `http:` server URLs (see `src/shared/serverUrls.ts`). Verify:
  - non-HTTPS is only used by explicit user intent (e.g. localhost/dev)
  - secrets are not silently sent over `http://` due to scheme defaulting

**Fail examples**:
- `?token=...` in any URL.
- Sending session API keys to a server URL that was inferred as `http://...` due to missing scheme.

### G. Conversation persistence: do not leak secrets to disk

Conversation stores are a persistence risk because they can contain:

- user messages (which may contain secrets)
- tool results / logs
- LLM request/response payloads (which may include headers)

- Files to inspect:
  - `src/extension/conversationStoreRoot.ts`
  - `src/webview/host/conversationHistory.ts`

**Pass criteria**:
- Directories created for conversation storage are restricted (e.g. `0700`) and files are restricted (e.g. `0600`) when the platform supports it.
- No code explicitly writes SecretStorage values (API keys, session keys) into conversation files.

### H. Webview surface hardening (CSP + link openers)

Because secrets may exist transiently in webview JS memory, treat webview XSS and unsafe openers as **credential leak** vectors.

- Files to inspect:
  - CSP: `src/webview/getWebviewHtml.ts`
  - Markdown link opener allowlist: `src/webview/host/handlers/openers.ts` (`handleOpenMarkdownLink`)
  - Tests: `src/__tests__/openMarkdownLink.security.test.ts`

**Pass criteria**:
- Webview CSP is restrictive (no remote scripts; `default-src 'none'` pattern).
- Link openers reject unsafe schemes (`javascript:`, `file://`) and block path traversal outside the workspace.

---

## 4) Suggested commands (quick checks)

These are **assistive** checks (expect false positives/negatives). The real audit is code-path based.

> Safety rule: avoid printing raw matching lines (they may contain secrets). Prefer `file:line` only.

- Find potential secret patterns in code (output paths + line numbers only):
  - `grep -RInE "sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{12,}|(AKIA|ASIA)[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*" src packages | cut -d: -f1-2 | sort -u`

- Find code paths that can write to disk:
  - `grep -RInE "\\.writeFile(Sync)?\\(|\\.appendFile(Sync)?\\(" src packages | cut -d: -f1-2 | sort -u`

- Find obvious logging sites:
  - `grep -RInE "console\\.(log|warn|error)" src packages src/webview-src | cut -d: -f1-2 | sort -u`

- Run tests:
  - `npm test`

---

## 5) What “good” looks like (call out positives)

These patterns are considered good practice in this repo; if present, explicitly list them under “Good practices already present”:

- Secrets stored using **VS Code SecretStorage** (`context.secrets.*`) and never written to settings JSON.
- Per-server session API keys keyed by a **hash of the normalized server URL** to reduce accidental cross-server reuse.
- Centralized masking utilities (`maskSecretsInText`, `safeStringify`) used for every logging surface.
- Profile persistence defaults to **not** saving inline secrets (`apiKeyRef.kind="inline"`) or `headers`.
- Conversation persistence uses restrictive file permissions (best-effort) for conversation stores.
- Webview CSP and opener allowlists reduce webview-based secret exfiltration risk.

---

## 6) Common pitfalls (flag if you see them)

- Any secret value written to:
  - `globalState`, `workspaceState`, `workspace.getConfiguration()`, or any JSON file
- Any secret printed in logs or thrown in error messages without masking
- Webview messages that echo secrets back to the UI or store them in persistent webview state
- Tokens included in URLs, query strings, or file paths
- Assuming a tool allowlist (`allowed-tools`) is enforced when it is not

---

## ATTENTION: FOOTGUNS

This section documents **current reality (today)** in this repo: the name `apiKey` appears in multiple domains and does **not** always mean the same thing.

This is a source of audit mistakes and security regressions. We should **improve this over time** (clearer naming and explicit types/formats), but in the meantime we must be careful to **not make it worse**.

### Key credential flows (source → sink) — verify each independently

| Domain / meaning | Where it lives (structure) | Typical source (where it comes from) | Sinks (where it ends up) | What can go wrong |
|---|---|---|---|---|
| **LLM provider credential** (OpenAI/Anthropic/Gemini/etc.) | `LLMConfiguration.apiKeyRef` (`packages/agent-sdk-ts/src/sdk/llm/types.ts`) and on-disk profile JSON (`~/.openhands/llm-profiles/*.json` when `includeSecrets=true`) | From SecretStorage / SecretRegistry, or explicit inline opt-in (`apiKeyRef.kind="inline"`) | Network requests to provider clients (`Authorization`, `x-api-key`, `x-goog-api-key`) | Easy to accidentally persist to disk or log. Treat `apiKeyRef.kind="inline"` as a secret; treat `apiKeyRef.kind="key"` as a reference name.
| **Webview → host payload secret** (user typed key) | Webview message: `llmProfileApiKeySetRequest.apiKey` (`src/shared/webviewMessages.ts`) | User types into webview UI (`src/webview-src/components/LlmProfilesView.tsx`) | Stored in `context.secrets.store(...)` and optionally `secretRegistry.set(...)` (`src/webview/host/handlers/llmProfiles.ts`) | Webview JS memory is a leak surface (console logs, devtools, XSS, persistence). Host must **never** echo secrets back to webview.
| **Agent-server session API key** (auth to OpenHands server) | `RemoteWorkspaceOptions.sessionApiKey` (`packages/agent-sdk-ts/src/workspace/RemoteWorkspace.ts`) and SecretStorage keys derived from normalized server URL (`src/auth/serverSessionApiKeys.ts`) | `settings.secrets.sessionApiKey` (remote conversation setup) | Network requests to agent-server via `X-Session-API-Key` / `Authorization: Bearer ...` | Confusing it with provider credentials can cause wrong-host leakage. Ensure per-server scoping and never attach to unintended hosts/redirects.
| **HAL / auxiliary service keys** (Gemini classifier, ElevenLabs, etc.) | Feature params objects (e.g. `src/hal/gemini/decisionClassifier.ts`, `src/hal/elevenlabs/ttsClient.ts`) | From SecretStorage-backed settings / secrets | Outbound requests to those services | Same logging/persistence risks, plus accidental reuse in unrelated contexts.

### Audit guidance

- Treat each credential-bearing field as **domain-specific**. During audit, always answer: *“which system is this credential for?”* before evaluating risk.
- When modifying code:
  - do not introduce new ambiguous `apiKey` fields/messages without strong justification
  - prefer explicit names (`sessionApiKey`, `providerApiKey`, `ttsApiKey`, etc.) and explicit reference types (`apiKeyRef`) over heuristics
  - ensure secrets never cross host → webview boundaries

If you suspect a leak but cannot prove it, write it as a **risk hypothesis** and point to the exact file + code region to inspect next.
