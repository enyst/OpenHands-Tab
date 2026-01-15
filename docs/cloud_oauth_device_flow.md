# OpenHands Cloud auth: OAuth 2.0 Device Flow (oh-tab design)

Bead: `oh-tab-voc.1` (investigation + design)

## Goal

Enable **remote** conversations against OpenHands Cloud servers (e.g. `app.all-hands.dev`) by obtaining and storing a **session API key** via **OAuth 2.0 Device Authorization Grant (“Device Flow”)**, matching the existing OpenHands-CLI behavior.

Non-goals (for this bead):
- Implement the flow end-to-end in oh-tab (covered by follow-up beads `oh-tab-voc.2+`).
- Define cloud-side auth policies or server changes.

## Current oh-tab behavior (baseline)

- Remote mode uses `settings.secrets.sessionApiKey` and sends it as `X-Session-API-Key` for remote agent-server calls (see `packages/agent-sdk-ts/src/workspace/RemoteWorkspace.ts` and `packages/agent-sdk-ts/src/sdk/conversation/RemoteConversation.ts`).
- When a remote server returns `401/403`, oh-tab currently shows: “Authentication failed - check your Session API Key in settings.” (see `RemoteConversation.startNewConversation()`).
- Tokens are stored in VS Code SecretStorage via `SettingsManager` / `VscodeSettingsAdapter` as `context.secrets` entries (see `src/settings/SettingsManager.ts` + `src/settings/VscodeSettingsAdapter.ts`).

## Reference implementation: OpenHands-CLI

OpenHands-CLI repo: `~/repos/OpenHands-CLI`

### Device Flow client

File: `openhands_cli/auth/device_flow.py`

Endpoints and payloads:
- `POST /oauth/device/authorize` with JSON body `{}`.
  - Expected response JSON fields:
    - `device_code: string`
    - `user_code: string`
    - `verification_uri: string`
    - `interval: number` (seconds)
- `POST /oauth/device/token` with form data `device_code=<...>` (CLI sends `data=...`, i.e. form-urlencoded).
  - Success: `200` with JSON containing at least `access_token` and `token_type`.
  - Errors (non-200): CLI expects JSON `{ error, error_description? }` with common cases:
    - `authorization_pending` → keep polling
    - `slow_down` → back off (CLI doubles interval up to 30s)
    - `expired_token` → fail (restart login)
    - `access_denied` → fail (user rejected)

UX:
- CLI constructs `verification_url = verification_uri + "?user_code=" + user_code`
- Tries to open browser, otherwise prints the URL and waits.
- Polling timeout default: 10 minutes.

### Token storage

File: `openhands_cli/auth/token_storage.py`

- Location: `~/.openhands/cloud/api_key.txt` (derived from `PERSISTENCE_DIR = ~/.openhands`).
- Format: plain text (just the key), file mode `0600`.

### Post-auth behavior (settings sync)

File: `openhands_cli/auth/api_client.py`

After auth, CLI fetches and prints/syncs:
- `GET /api/keys/llm/byor` (BYO LLM key)
- `GET /api/settings`
- (Also has `GET /api/user/info` helper and `POST /api/conversations` helper.)

Note: oh-tab may or may not want to mirror this “sync” step; see “Open questions”.

## Design: oh-tab implementation plan

### Architecture placement

Recommendation:
- Keep auth orchestration in **extension host** (needs VS Code APIs + SecretStorage + safe UX):
  - new module(s) under `src/auth/`
- Keep only small, pure helpers in `src/shared/` (e.g. server URL normalization already lives there).
- Avoid putting auth logic into `packages/agent-sdk-ts` for now; the SDK should remain transport-agnostic and accept “sessionApiKey” as an input.

### Token storage model (per-server)

Problem:
- oh-tab currently stores a single `openhands.sessionApiKey`. But users can have multiple `settings.servers[]`, and cloud tokens are effectively “account/session scoped” (and may differ per environment).

Recommendation:
- Store a token **per canonical server URL** in VS Code SecretStorage.

Suggested secret keys:
- `openhands.sessionApiKey` (legacy / “effective” key; keep for backwards compatibility)
- `openhands.sessionApiKey.server.<hash>` (server-specific token)
- `openhands.sessionApiKey.server.<hash>.meta` (optional JSON metadata; e.g. `{ serverUrl, obtainedAt, tokenType, expiresAt? }`)

Where `<hash>` is a stable hash of the normalized server URL (e.g. SHA-256 hex of `normalizeServerUrl(url).url`).

Lookup rules:
1. Normalize server URL (`normalizeServerUrl`).
2. Attempt per-server key first.
3. Fall back to `openhands.sessionApiKey` (so existing manual workflows keep working).

Write rules:
- Whenever a token is obtained for a server, store it in the per-server key and (optionally) also update `openhands.sessionApiKey` to the same value for “effective” compatibility.

### CLI token reuse (optional)

CLI stores a cloud token at `~/.openhands/cloud/api_key.txt`.

Feasibility:
- oh-tab can read this file using Node’s `os.homedir()` + `path.join(...)`.
- The file is not keyed by server URL; it represents “whatever CLI last logged into”.

Recommended behavior:
- If the per-server token is missing, attempt “import from CLI” as a best-effort:
  1. If `~/.openhands/cloud/api_key.txt` exists and contains a non-empty token:
  2. Validate it against the selected server (e.g. call `GET /api/user/info` or a cheap authenticated endpoint).
  3. If valid, store it in the per-server SecretStorage key and proceed.
  4. If invalid, ignore and fall back to running device flow.

UX/security:
- Do not silently “copy secrets” without user awareness. Prefer a prompt:
  - “Import your existing OpenHands-CLI login for this server?” [Import] [No]
- Never log the token to output channels.

### Device flow orchestration (host-side)

New extension-host service (proposed):
- `CloudAuthService` (name bikeshed)
  - `startDeviceFlow(serverUrl) -> { deviceCode, userCode, verificationUri, verificationUrl, intervalSeconds }`
  - `pollForToken(serverUrl, deviceCode, intervalSeconds, { timeoutMs, onStatus }) -> { accessToken, tokenType, expiresIn? }`
  - `login(serverUrl) -> token` (does `start` + open browser + poll + store)
  - `logout(serverUrl) -> void` (clears per-server token + legacy key when applicable)

Transport details:
- Use `fetch` from extension host.
- `POST /oauth/device/authorize` JSON body `{}`.
- `POST /oauth/device/token` with `application/x-www-form-urlencoded` body `device_code=<...>`.
- Error parsing should mirror CLI’s `error` values.

VS Code UX:
- Use `vscode.env.openExternal(vscode.Uri.parse(verificationUrl))`.
- Show a modal/progress UI with cancel:
  - `vscode.window.withProgress({ location: Notification, cancellable: true }, ...)`
- Provide “Copy code” and “Copy URL” affordances (either buttons in notifications or quick-picks).

### Webview integration

Recommended triggers:
- Add a command surfaced in UI:
  - “Login to server …” (in server selector popover and/or command palette)
- Add an automatic prompt when:
  - User switches to remote mode and the selected server responds `401/403`.
  - HAL teleport attempts to connect and auth is missing/invalid.

Suggested message contract (webview ↔ host):
- Webview → host: `command: 'cloudAuthLogin' | 'cloudAuthLogout'`
- Host → webview:
  - `cloudAuthStarted { serverUrl, verificationUrl, userCode }`
  - `cloudAuthPolling { serverUrl, nextPollInSeconds }` (optional)
  - `cloudAuthSucceeded { serverUrl }`
  - `cloudAuthFailed { serverUrl, error }`

The host should remain the source of truth for token storage; webview should never receive the token value.

### Header compatibility (Bearer vs X-Session-API-Key)

CLI uses `Authorization: Bearer <token>` for `/api/*` calls.
oh-tab’s remote agent-server currently uses `X-Session-API-Key: <token>`.

Open question:
- Whether OpenHands Cloud accepts both headers for all relevant endpoints.

Recommendation:
- In follow-up implementation, consider sending **both headers** (same token) for remote agent-server API calls to maximize compatibility:
  - `Authorization: Bearer <token>`
  - `X-Session-API-Key: <token>`
This can be done in `RemoteConversation.getAuthHeaders()` and `RemoteWorkspace.getAuthHeaders()`.

## Sequence diagrams

### User-initiated login

```mermaid
sequenceDiagram
  participant UI as Webview UI
  participant Host as Extension Host
  participant Cloud as Cloud Server

  UI->>Host: cloudAuthLogin(serverUrl)
  Host->>Cloud: POST /oauth/device/authorize {}
  Cloud-->>Host: { device_code, user_code, verification_uri, interval }
  Host->>Host: openExternal(verification_uri?user_code=...)
  loop until success/timeout/cancel
    Host->>Cloud: POST /oauth/device/token (device_code)
    alt authorization_pending
      Cloud-->>Host: 400 { error: authorization_pending }
    else slow_down
      Cloud-->>Host: 400 { error: slow_down }
    else success
      Cloud-->>Host: 200 { access_token, token_type, ... }
    else access_denied/expired_token/other
      Cloud-->>Host: 400 { error: ... }
    end
  end
  Host->>Host: store token in SecretStorage (per-server)
  Host-->>UI: cloudAuthSucceeded
```

### Auto-login on 401 during remote connect

```mermaid
sequenceDiagram
  participant Host as Extension Host
  participant SDK as RemoteConversation
  participant Cloud as Cloud Server

  Host->>SDK: startNewConversation()
  SDK->>Cloud: POST /api/conversations (auth headers)
  Cloud-->>SDK: 401/403
  SDK-->>Host: error("Authentication failed...")
  Host->>Host: prompt user to login
  Host->>Cloud: OAuth device flow (as above)
  Host->>SDK: setSettings({ secrets: { sessionApiKey: token } })
  Host->>SDK: startNewConversation() retry
```

## Open questions / follow-ups

1. **Settings sync parity:** Should oh-tab fetch `/api/settings` after login (like CLI) and update local UI defaults for remote mode?
2. **Token expiry:** If the access token expires, what is the expected renewal mechanism (re-login vs refresh token)?
3. **Multi-server tokens:** Should UI expose “Logged in as …” per server and allow per-server logout?
4. **Header scheme:** Confirm whether cloud accepts `X-Session-API-Key` for all endpoints used by remote mode, or if Bearer is required.

