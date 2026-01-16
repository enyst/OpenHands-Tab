---
name: audit
description: >
  Security audit checklist for the OpenHands-Tab VS Code extension, focused on preventing API keys
  and tokens from being persisted or logged. Use when asked to audit security, secret handling,
  credential storage, logging redaction, or data exfiltration risks in this repo. Trigger with /audit.
license: MIT
triggers:
  - /audit
  - security audit
  - audit security
  - api key leak
  - token leak
  - credential leak
  - SecretStorage
---

# OpenHands-Tab Security Audit Skill

This skill teaches you how to audit **this repository** (the OpenHands-Tab VS Code extension) for common secret-handling and credential-leak problems.

## Command: `/audit`

When the user asks for a security review (or types `/audit`), produce a short written audit report by following the steps below.

### Output format (required)

Return a report with:

1. **Scope** (what you reviewed)
2. **High risk findings** (must fix)
3. **Medium/low risk findings** (should fix)
4. **Good practices already present** (keep)
5. **Suggested follow-ups** (tests, hardening, docs)

Never include real secret values in the report.

---

## 1) Threat model (keep it concrete)

For this extension, the primary risks are:

- **Accidental persistence of secrets to disk** (VS Code settings JSON, profile files, logs, conversation stores)
- **Accidental logging of secrets** (OutputChannel, debug channels, dev bridge logs, error messages)
- **Webview boundary leaks** (secrets sent to webview, persisted in webview state, or logged to console)
- **Network exfiltration** (tokens placed in URLs, sent to wrong host, or sent without TLS)

---

## 2) Inventory: what counts as a secret in this repo

### VS Code SecretStorage keys (provider keys)

These keys are stored via `context.secrets` and must never be written to disk or logs:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `LITELLM_API_KEY`

Relevant code:

- `src/webview/host/handlers/secretHelpers.ts` (maps provider → env/SecretStorage key)
- `src/extension/secretCommands.ts` (UI to set/clear provider keys)

### Extension-managed secrets (stored under `openhands.*` keys)

These are also secrets; they should be stored **only** in SecretStorage:

- `openhands.sessionApiKey` (legacy)
- `openhands.llmApiKey`
- `openhands.awsAccessKeyId`
- `openhands.awsSecretAccessKey`
- `openhands.githubToken`
- `openhands.hal.ttsApiKey`
- `openhands.customSecret1/2/3`

Relevant code:

- `src/settings/SettingsManager.ts` (loads/stores these via `adapter.getSecret/storeSecret`)
- `src/settings/VscodeSettingsAdapter.ts` (backed by `context.secrets`)

---

## 3) Audit checklist (step-by-step)

### A. Confirm secrets are not persisted in VS Code settings

1. Verify the settings adapter does **not** store secrets via `workspace.getConfiguration().update(...)`.
   - Expectation: all secret writes go through `context.secrets.store/delete`.
   - Files:
     - `src/settings/VscodeSettingsAdapter.ts`
     - `src/settings/SettingsManager.ts`
     - `src/extension/secretCommands.ts`

2. Verify any “status indicators” written to settings are non-sensitive.
   - File: `src/extension/secretCommands.ts`
   - Expectation: only a marker like `"✓ set"`, never the secret.

### B. Confirm per-server session API keys cannot be reused for arbitrary servers

1. Locate the per-server session key naming.
   - File: `src/auth/serverSessionApiKeys.ts`
   - Expectation: key name includes a **hash** of the normalized server URL:
     - `openhands.sessionApiKey.server.${sha256(normalizedUrl)}`

2. Verify migration behavior is conservative.
   - File: `src/extension.ts`
   - Expectation: if a legacy session key exists, the extension should:
     - NOT auto-send it to whatever server is configured
     - Prompt the user before storing it under the hashed per-server key

### C. Confirm secrets don’t cross into the webview unnecessarily

1. Inspect webview ↔ host messages related to API key overrides.
   - Host handler: `src/webview/host/handlers/llmProfiles.ts` (`llmProfileApiKeySetRequest`)
   - UI: `src/webview-src/components/LlmProfilesView.tsx`

2. Expectations:
   - The webview may temporarily hold a draft API key in memory for UX, but it must not be persisted.
   - The host must store the API key in `context.secrets`, not in files.
   - No `console.log`/debug logging should print the key or headers.

### D. Confirm profile persistence strips secrets by default

Profiles can contain inline `apiKey` or `headers` in config, which are high risk if persisted.

1. Verify profile persistence removes inline secrets unless explicitly opted-in.
   - Host store wrapper: `src/webview/host/llmProfilesStore.ts`
   - SDK store: `packages/agent-sdk-ts/src/sdk/llm/profiles.ts`

2. Expectations:
   - `includeSecrets` defaults to `false`.
   - When `includeSecrets=false`, both `apiKey` (if it looks like a real key, not an ENV var name) and `headers` are stripped.

### E. Confirm logs are redacted everywhere secrets may appear

This repo has multiple logging surfaces. Verify each is covered.

1. Output channel masking
   - File: `src/extension/devBridgeLogger.ts` (`createMaskedOutputChannel`)
   - Expectation: any `append/appendLine/replace` path masks via `maskSecretsInText(...)`.

2. Debug JSON channel masking
   - File: `src/extension/debugJsonOutputChannel.ts`
   - Expectation: redacts using `maskSecretsInText(...)`.

3. Generic string redaction
   - File: `src/shared/safeStringify.ts`
   - Expectation: heuristically redacts common patterns (`Authorization: Bearer ...`, `sk-...`, GitHub tokens, etc.).

4. “Known secret value” masking
   - File: `src/shared/maskSecrets.ts`
   - Expectation: uses a registry of known secret values (`SecretRegistry`) to replace exact matches.

Audit technique:

- Search for new/unmasked loggers:
  - `console.log`, `console.warn`, `console.error`
  - `outputChannel.appendLine` / `append`
  - any `JSON.stringify(...)` used for logging

If you find a logging path that doesn’t go through redaction utilities, flag it.

### F. Confirm secrets are not placed in URLs

Tokens must be sent in headers, never as query parameters.

- Search for code that builds URLs with `token=`, `api_key=`, `key=`.
- Ensure remote calls use `Authorization: Bearer ...` headers.

---

## 4) Suggested commands (optional, but recommended)

If you have repo access, run quick checks:

- Find potential secret patterns committed to code:
  - `grep -RInE "sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{12,}|(AKIA|ASIA)[A-Z0-9]{16}" src packages`

- Find places secrets might be written:
  - `grep -RInE "writeFile|appendFile|fs\\." src packages`
  - `grep -RInE "console\\.(log|warn|error)" src packages`

- Run tests that cover redaction and profile persistence:
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
