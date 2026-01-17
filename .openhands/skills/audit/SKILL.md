---
name: audit
description: >
  AgentSkill: run a repo-specific security audit of the OpenHands-Tab VS Code extension with a focus on
  secret handling, webview/host boundaries, persistence, and logging redaction. Trigger with /audit.
license: MIT
triggers:
  - /audit
---

# OpenHands-Tab Security Audit (AgentSkill)

This is a **repeatable checklist** for an agent to run against *this repository*.

When invoked (e.g. the user types `/audit`), follow the checklist below, inspect the referenced code, and then output a short audit report.

## Output format (required)

Return a report with:

1. **Scope** (what you inspected)
2. **High-risk findings** (must fix)
3. **Medium/low-risk findings** (should fix)
4. **Good practices already present** (keep)
5. **Suggested follow-ups** (tests, hardening, docs)

**Never include real secret values** in the report (including partial tokens).

---

## 1) Threat model (repo-specific)

Primary risks for this VS Code extension:

- **Persistence leaks**: secrets written to disk (VS Code settings JSON, profile files, workspace/global state, logs, conversation stores)
- **Logging leaks**: secrets exposed via OutputChannel, debug channels, error strings/stack traces, dev bridge logs, webview console
- **Webview boundary leaks**: secrets crossing extension-host ↔ webview boundary; secrets persisted in webview state (`acquireVsCodeApi().setState`) or leaked via console
- **Network leaks**: secrets in URLs/query params, secrets sent to wrong host, secrets attached to redirected requests, non-HTTPS when not explicitly intended

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
- Writing `apiKey`, `token`, `Authorization` headers, or full provider configs into settings JSON.

### B. Confirm per-server session API keys are scoped to a specific server

**Check**: session keys are not “global”; they must be bound to a specific normalized server URL.

- Files to inspect:
  - `src/auth/serverSessionApiKeys.ts`
  - `src/shared/serverUrls.ts` (normalization rules)
  - `src/extension.ts` (migration / usage)

**Pass criteria**:
- The SecretStorage key name includes a stable identifier derived from the normalized server URL (e.g. a hash).
- The normalized URL logic is understood and documented by the audit:
  - This repo’s `normalizeServerUrl(...)` supports both `http:` and `https:` and may default to `http://` when no scheme is provided.
- Migration from any legacy/global key is conservative:
  - Do not automatically re-bind a legacy key to an arbitrary configured server without explicit user intent.

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
  - no `acquireVsCodeApi().setState(...)` (or other persistence) storing `apiKey`, headers, or tokens
- On submit:
  - webview sends the key to the host once, host stores it in SecretStorage, and the webview clears local state promptly.
- No logging on either side:
  - webview: no `console.log` / error reporting that includes key material
  - host: no OutputChannel/dev logging of message payloads containing keys

**Fail examples**:
- Host echoes a stored key back to the webview for “display”.
- Webview caches the key in persistent state to “remember” it.

### D. Profile persistence: do not write secrets to disk by default

Profiles can contain inline `apiKey` or `headers`, which are **high-risk** if persisted.

- Files to inspect:
  - Host store wrapper: `src/webview/host/llmProfilesStore.ts`
  - SDK store: `packages/agent-sdk-ts/src/sdk/llm/profiles.ts`

**Check**: profile save paths have a default mode that **excludes secrets**.

**Pass criteria**:
- A save option like `includeSecrets` exists and defaults to `false`.
- When `includeSecrets=false`:
  - `apiKey` is removed unless it is an explicit non-secret reference (e.g. an env-var indirection supported by this repo).
  - `headers` are removed (or strictly allowlisted); never persist `Authorization` or cookies.

**Fail examples**:
- Persisting literal API keys or Authorization headers into any profile JSON file by default.
- A heuristic like “strip if it looks like a real key” without a well-defined representation of non-secret references.

### E. Logging & error handling: assume redaction is imperfect

**Rule**: the primary defense is **do not log secrets at all**. Redaction is a backstop.

- Files to inspect:
  - Output channel masking: `src/extension/devBridgeLogger.ts` (`createMaskedOutputChannel`)
  - Debug JSON channel masking: `src/extension/debugJsonOutputChannel.ts`
  - Generic safe logging: `src/shared/safeStringify.ts`
  - Known-secret masking registry: `src/shared/maskSecrets.ts`

**Checks**:
1. All extension-host logging surfaces run through masking utilities.
2. Any errors posted to OutputChannel / webview / UI are sanitized:
   - do not include request headers, Authorization, cookies, or full config objects.
3. Webview-side logging is clean:
   - no `console.*` printing request payloads that may contain secrets.

**Audit technique**:
- Search for unmasked loggers:
  - `console.(log|warn|error)` in both `src/` and `src/webview-src/`
  - direct `outputChannel.append/appendLine/replace`
  - `JSON.stringify(...)` used in logs
- When you find one, trace whether it flows through `maskSecretsInText(...)` or equivalent.

**Fail examples**:
- Logging the full webview message payload of `llmProfileApiKeySetRequest`.
- Throwing/printing errors that embed headers or config with inline `apiKey`.

### F. Network requests: keep secrets out of URLs and off the wrong host

**Checks**:
- No code constructs URLs containing secrets (`token=`, `api_key=`, `key=`, `authorization=`).
- Secrets are sent via headers, not query params.
- Ensure Authorization headers are only attached to the intended host:
  - audit for redirect-following behavior and whether headers are preserved across redirects.

**Repo-specific note**:
- This repo supports `http:` server URLs (see `src/shared/serverUrls.ts`). If non-HTTPS is allowed, verify:
  - it is explicit user intent (e.g. localhost/dev)
  - secrets are not silently sent over `http://` due to scheme defaulting

**Fail examples**:
- `?token=...` in any URL.
- Sending session API keys to a server URL that was inferred as `http://...` due to missing scheme.

---

## 4) Suggested commands (quick checks)

These are **assistive** checks (expect false positives/negatives). The real audit is code-path based.

- Find potential secret patterns committed to code (add context):
  - `grep -RInEC 2 "sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{12,}|(AKIA|ASIA)[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+" src packages`

- Find code paths that can write to disk (reduce noise):
  - `grep -RInE "\\.writeFile(Sync)?\\(|\\.appendFile(Sync)?\\(" src packages`

- Find obvious logging sites:
  - `grep -RInE "console\\.(log|warn|error)" src packages src/webview-src`

- Run tests:
  - `npm test`

---

## 5) What “good” looks like (call out positives)

These patterns are considered good practice in this repo; if present, explicitly list them under “Good practices already present”:

- Secrets stored using **VS Code SecretStorage** (`context.secrets.*`) and never written to settings JSON.
- Per-server session API keys keyed by a **hash of the server URL** to reduce accidental cross-server reuse.
- Centralized masking utilities (`maskSecretsInText`, `safeStringify`) used for every logging surface.
- Profile persistence defaults to **not** saving inline `apiKey`/`headers`.

---

## 6) Common pitfalls (flag if you see them)

- Any secret value written to:
  - `globalState`, `workspaceState`, `workspace.getConfiguration()`, or any JSON file under the repo
- Any secret printed in logs or thrown in error messages without masking
- Webview messages that echo secrets back to the UI or store them in persistent webview state
- Tokens included in URLs, query strings, or file paths

If you suspect a leak but cannot prove it, write it as a **risk hypothesis** and point to the exact file + code region to inspect next.
