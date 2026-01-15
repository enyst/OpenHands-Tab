# Secret storage semantics (OpenHands-Tab)

This note documents how secrets are interpreted when flowing through the TypeScript SDK’s `SecretRegistry` (used for LLM API keys, auth tokens, etc).

## Canonical behavior

**`SecretRegistry.set(name, value)`**
- Trims `value`.
- If the trimmed value is empty, the secret is treated as **unset** (the entry is deleted).
- Otherwise, the trimmed value is stored.

**`SecretRegistry.get(name)`**
- Returns the in-memory cached value if present.
- Otherwise queries VS Code `SecretStorage` (when available):
  - Trims the stored value.
  - If the trimmed value is empty, it is treated as **unset** and ignored.
  - If non-empty, the trimmed value is returned and cached.
- Otherwise queries `process.env[name.toUpperCase()]`:
  - Trims the env value.
  - If the trimmed value is empty, it is treated as **unset**.
  - If non-empty, the trimmed value is returned and cached.

## Rationale

- Avoids treating accidental whitespace-only secrets as “set” (which can produce confusing auth failures).
- Keeps behavior consistent between writes (`set`) and reads (`get`).

## When you need “empty string counts as set”

Some features may need CLI-like semantics where “present but empty” should be considered *set*. Don’t route those through `SecretRegistry`; instead, use a dedicated wrapper with explicit semantics (e.g. a token/settings adapter that preserves empty-string values).

