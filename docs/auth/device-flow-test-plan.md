# OAuth Device Flow test plan (TypeScript)

This document captures the intended test scenarios for `oh-tab-voc.3` (OAuth 2.0 Device Flow auth for cloud servers).

It is a **porting plan** derived from the OpenHands-CLI Python tests listed in the `oh-tab-voc.2` Bead:

- `tests/auth/test_device_flow.py`
- `tests/auth/test_http_client.py`
- `tests/auth/test_token_storage.py`
- `tests/auth/test_api_client.py`
- `tests/auth/test_login_command.py`
- `tests/auth/test_logout_command.py`

## Device flow

- Start flow: POST device authorization endpoint, return `device_code`, `user_code`, `verification_uri(_complete)`, `interval`.
- Poll flow:
  - `authorization_pending` keeps polling until success/timeout.
  - `slow_down` increases polling interval.
  - `expired_token` fails with an instruction to restart login.
  - `access_denied` fails with an instruction that the user rejected.
  - Unknown errors surface `error` + `error_description` (when present).
  - User cancel stops polling.
  - Hard timeout (e.g. 10 minutes) stops polling.
- Verification URL handling:
  - Build `verification_uri_complete` from `verification_uri` + `user_code`, preserving existing query params.
- Token exchange payload:
  - Includes `grant_type=urn:ietf:params:oauth:grant-type:device_code` and `device_code`.

## HTTP client

- Required headers:
  - Content-Type for form payloads.
  - Authorization header injection when present.
- Error mapping:
  - Non-2xx responses parse JSON error payloads when available; otherwise include raw text.
  - Invalid JSON error bodies handled gracefully.
- Timeouts:
  - Abort after configured duration.
- URL normalization:
  - Accept `ws://` / `wss://` server URLs and normalize to `http(s)://` base URL for HTTP endpoints.

## Token storage

- Per-server token storage uses a canonical server URL key.
- Device flow stores the **cloud API key** only (device-flow `access_token`) under `openhands.cloudApiKey.server.<hash>`.
- Delete token:
  - Clears the per-server cloud token and leaves other servers untouched.
- Metadata storage:
  - Stores non-secret metadata (e.g. obtainedAt/expiresAt/tokenType) separately from the secret.

## API client

- Validates imported CLI token via a cheap authenticated endpoint (e.g. `GET /api/user/info`).
- Optional parity check with settings endpoint (if retained): `GET /api/settings`.
- 401/403 maps to a typed auth error suitable for prompting user to login.

## Login command

- Login triggers device flow and stores token for the selected server.
- If a CLI token file is present:
  - Prompt user to import.
  - Validate token before storing it.
- On 401/403 during remote connect:
  - Host prompts to login.
  - Retries after success.

## Logout command

- Logout clears per-server token and leaves other servers untouched.
- Logout updates UI state (logged-in indicator) without leaking tokens.
