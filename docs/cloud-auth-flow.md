# OpenHands Cloud auth vs agent-server session API keys (CLI / enterprise / app_server)

This document captures the concrete code paths we inspected (Jan 17, 2026) to understand:

- What the OpenHands **cloud “login key”** actually is (OAuth device flow output)
- What an **agent-server “session API key”** is (runtime/sandbox-scoped)
- How the **SaaS/app-server** composes these when running managed remote sandboxes
- Implications for **OpenHands-Tab** (`oh-tab`) and `packages/agent-sdk-ts` RemoteConversation/RemoteWorkspace

The key takeaway: **cloud device-flow returns a user API key / access token for the SaaS server, not the per-sandbox agent-server session key.**

---

## 0) Terminology (use consistent names)

### A) Cloud device-flow token (aka “cloud API key”, “device link access key”)
- **Origin:** OAuth 2.0 Device Flow endpoints on the SaaS server
- **Used to authenticate to:** SaaS server HTTP APIs (e.g. `/api/user/info`, `/api/settings`, cloud conversation creation)
- **Transport:** `Authorization: Bearer <token>` (clients should treat this as the canonical scheme)
- **Storage (CLI):** `~/.openhands/cloud/api_key.txt` (owner-only perms)

### B) Agent-server session API key (runtime/sandbox scoped)
- **Origin:** Sandbox/runtime creation (generated per sandbox/runtime)
- **Used to authenticate to:** the **nested runtime / agent-server** HTTP APIs and its WebSocket/event stream
- **Transport (HTTP):** `X-Session-API-Key: <session_api_key>` (and sometimes also `Authorization: Bearer …` in TS client)
- **Transport (WS):** currently frequently appears as a **query param** `?session_api_key=…` for browser WS constraints (this is the `oh-tab-h3g` security concern)

---

## 1) OpenHands-CLI: how the cloud key is produced + stored

### 1.1 Device flow client
**File:** `~/repos/OpenHands-CLI/openhands_cli/auth/device_flow.py`

- Calls:
  - `POST /oauth/device/authorize`
  - polls `POST /oauth/device/token`
- Expects token JSON with `access_token` and stores it.

### 1.2 Token storage location + permissions
**File:** `~/repos/OpenHands-CLI/openhands_cli/auth/token_storage.py`

- Default storage directory is `~/.openhands/cloud/`
- Writes `api_key.txt` and sets permissions to `0o600`.

### 1.3 How the CLI uses the token
**File:** `~/repos/OpenHands-CLI/openhands_cli/auth/api_client.py`

- Uses the stored token as:
  - `Authorization: Bearer <api_key>`
- Example endpoints the CLI calls:
  - `GET /api/user/info`
  - `GET /api/settings`
  - `GET /api/keys/llm/byor`
  - `POST /api/conversations` (cloud conversation creation)

### 1.4 Cloud conversation command uses that token
**File:** `~/repos/OpenHands-CLI/openhands_cli/cloud/conversation.py`

- Validates token by calling `get_user_info()` (401 => invalid)
- Uses `POST /api/conversations` with `Authorization: Bearer …`.

**Implication:** the CLI’s “cloud api key” is a bearer credential for the **SaaS server** API surface.

---

## 2) Enterprise SaaS server: what `/oauth/device/token` returns

### 2.1 Device flow endpoints are implemented here
**File:** `~/repos/odie/enterprise/server/routes/oauth_device.py`

Key behavior:
- `POST /oauth/device/token` returns `DeviceTokenResponse(access_token=…)`
- **That `access_token` is actually an API key retrieved from `ApiKeyStore`**, named like:
  - `Device Link Access Key (<user_code>)`
- The code comment is explicit:
  - `access_token: str  # This will be the user's API key`

So although it’s shaped like OAuth, the “access token” is effectively an **API key** used to authenticate SaaS HTTP requests.

### 2.2 SaaS auth accepts Bearer (and sometimes X-Session-API-Key as fallback)
**File:** `~/repos/odie/enterprise/server/auth/saas_user_auth.py`

- `get_api_key_from_header()` logic:
  1) Prefer `Authorization: Bearer <token>`
  2) Fallback to `X-Session-API-Key` (explicitly described as a “temp hack” for an HTTP MCP redirect/header-drop issue)
  3) Fallback to `X-Access-Token`

- `saas_user_auth_from_bearer()` validates the API key via `ApiKeyStore.validate_api_key(api_key)`.

**Important:** this is *not* the runtime/sandbox session key; it’s a user API key used for SaaS authentication.

### 2.3 SaaS middleware gate: routes require either cookie or bearer-like credential
**File:** `~/repos/odie/enterprise/server/middleware.py`

- Requests to most `/api/*` and `/mcp/*` paths require credentials.
- It treats `Authorization: Bearer …` as the primary API credential.
- It also treats `X-Session-API-Key` as an acceptable substitute when Authorization is absent.

### 2.4 SaaS nested runtime manager: returns a *separate* `session_api_key` for the nested runtime
**File:** `~/repos/odie/enterprise/server/saas_nested_conversation_manager.py`

Inside `maybe_start_agent_loop()`:
- Reads runtime data (from the remote runtime API) including:
  - `nested_url = ...`
  - `session_api_key = runtime.get('session_api_key')`
- Returns `AgentLoopInfo(conversation_id, url=nested_url, session_api_key=session_api_key, ...)`

And later (e.g. `_get_runtime_status_from_nested_runtime()`):
- Uses `X-Session-API-Key: session_api_key` in an `httpx.AsyncClient` to call the **nested runtime URL**.

**Implication:** SaaS server itself clearly distinguishes:
- a user API key for SaaS authentication, and
- a runtime-provided `session_api_key` used to authenticate requests *to the nested agent-server*.

---

## 3) App-server (V1) code: how session_api_key + conversation_url are constructed

### 3.1 AppConversation model includes both `conversation_url` and `session_api_key`
**File:** `~/repos/odie/openhands/app_server/app_conversation/app_conversation_models.py`

`AppConversation` contains:
- `conversation_url`: “URL where the conversation may be accessed”
- `session_api_key`: “Session Api Key for REST operations”

### 3.2 Where those fields are populated
**File:** `~/repos/odie/openhands/app_server/app_conversation/live_status_app_conversation_service.py`

In `_build_conversation(...)`:
- Finds the agent-server base URL from `sandbox.exposed_urls` (where `exposed_url.name == AGENT_SERVER`)
- Sets:
  - `conversation_url = <agent_server_url> + '/api/conversations/<conversation_uuid>'`
  - `session_api_key = sandbox.session_api_key`

This is the concrete “two-interface” bridge:
- App-server knows the sandbox’s agent-server URL and its session key.
- App-server can return those to the caller as part of `AppConversation`.

### 3.3 How V1 routes are mounted
**File:** `~/repos/odie/openhands/app_server/v1_router.py`

- `router = APIRouter(prefix='/api/v1')`
- Includes `app_conversation_router` which itself has prefix `/app-conversations`.

So V1 “app conversations” endpoints are under:
- `POST /api/v1/app-conversations`
- `POST /api/v1/app-conversations/stream-start`
- `GET /api/v1/app-conversations?ids=<uuid>&ids=<uuid>` (batch-get)
- `GET /api/v1/app-conversations/search` (paged search)
- etc.

### 3.4 How V1 can call into the agent-server internally
**File:** `~/repos/odie/openhands/app_server/app_conversation/app_conversation_router.py`

Example: endpoints like `GET /api/v1/app-conversations/{conversation_id}/file`:
- Determine agent-server URL from sandbox.exposed_urls
- Construct `AsyncRemoteWorkspace(host=agent_server_url, api_key=sandbox.session_api_key, ...)`
- Use that workspace client to call the nested runtime.

**Implication:** the **sandbox session_api_key** is used as the authentication credential for nested runtime operations.

---

## 4) OpenHands (server/) legacy V0 vs agent-server WS auth

### 4.1 Legacy V0 socket auth checks query param `session_api_key`
**File:** `~/repos/odie/openhands/server/listen_socket.py`

This legacy Socket.IO path checks environment `SESSION_API_KEY` and expects a query param `session_api_key`.

Note: this file explicitly labels itself “LEGACY V0 CODE” and warns not to extend it.

### 4.2 Agent-server WS auth (current upstream behavior relevant to `oh-tab-h3g`)
**Repo:** `~/repos/agent-sdk` (python agent-server)

(Previously inspected in our audit follow-up work)
- Agent-server WS currently requires `session_api_key` query param when session auth is enabled.
- BlackCastle validated locally that **headers-only WS fails** when `SESSION_API_KEY` is set.

---

## 5) OpenHands-Tab (`oh-tab`) / agent-sdk-ts: current client behavior

### 5.1 VS Code extension cloud login stores the device-flow access token as “Cloud API Key”
**File:** `src/extension/cloudLoginCommand.ts`

- Runs device flow against the currently selected `settings.serverUrl`.
- Stores returned `access_token` in VS Code SecretStorage under a per-server **cloud API key** slot.
- Logs: `[auth] Stored cloud API key for <normalizedServerUrl>.`

### 5.2 RemoteConversation uses distinct keys for SaaS vs nested runtime
**File:** `packages/agent-sdk-ts/src/sdk/conversation/RemoteConversation.ts`

- For cloud/SaaS hosts, `getAuthHeaders()` uses:
  - `Authorization: Bearer <cloudApiKey>`
- For non-cloud agent-servers, `getAuthHeaders()` uses:
  - `X-Session-API-Key: <runtimeSessionApiKey>`

- `connect()` constructs WS URL:
  - `${base.replace(/^http/, 'ws')}/sockets/events/${conversationId}?session_api_key=<runtimeSessionApiKey>&resend_all=true` (non-cloud only)

This is the exact “secret-in-URL” issue from bead `oh-tab-h3g`.

Clarification:
- The cloud/SaaS device-flow token should be sent as `Authorization: Bearer <cloud_api_key>` to SaaS endpoints.
- The runtime/sandbox `session_api_key` should be sent as `X-Session-API-Key: <runtime_session_api_key>` to the nested agent-server (and currently as `?session_api_key=...` for WS).

### 5.3 Why the cloud token vs runtime token confusion matters
There are multiple server surfaces:

1) **SaaS server surface** (enterprise / app.all-hands.dev)
   - Auth via user API key / Bearer token (device-flow output)

2) **Agent-server surface** (nested runtime inside a sandbox)
   - Auth via sandbox/session-scoped session_api_key

The V1 app-server code explicitly shows that `session_api_key` is a sandbox/runtime key (not the SaaS user API key).

So if `oh-tab` config points `serverUrl` at the SaaS server and reuses the SaaS user API key as the agent-server session key, that may not work unless SaaS intentionally forwards/proxies and accepts that token on the nested surface.

---

## 6) Practical implications / lessons for `RemoteConversation` and `RemoteWorkspace`

### 6.1 What “correct cloud remote mode” likely needs (V1-aligned)
A V1-aligned client flow generally looks like:

1) **Login to SaaS** (device flow)
   - store `cloud_api_key` (user API key)

2) **Ask SaaS/app-server to start or locate a sandboxed conversation**
   - via a SaaS endpoint that returns (directly or indirectly):
     - `agent_server_url`
     - `session_api_key` (sandbox/runtime)
     - `conversation_id`

3) **Connect directly to the agent-server**
   - use `agent_server_url` as the base
   - use `session_api_key` as the runtime credential

4) **For WS auth (`oh-tab-h3g`)**
   - ideal: server supports WS header auth or a short-lived ticket
   - current reality: server requires `?session_api_key=…` query param

### 6.2 Concretely: where to get `agent_server_url` and runtime `session_api_key`
From V1 app-server code:
- `AppConversation.conversation_url` is built as:
  - `<agent_server_url>/api/conversations/<conversation_uuid>`
- `AppConversation.session_api_key` is:
  - `sandbox.session_api_key`

So any endpoint returning `AppConversation` can be the source of truth.

In practice, concrete endpoints that return this nested runtime connection info include:

**V1 (preferred; `/api/v1`)**
- `GET /api/v1/app-conversations?ids=<uuid>&ids=<uuid>`
  - Batch-get.
  - Returns `list[AppConversation | null]`.
  - Each `AppConversation` includes:
    - `conversation_url` (contains the nested `agent_server_url`)
    - `session_api_key` (runtime/sandbox credential for the nested agent-server)
- `GET /api/v1/app-conversations/search`
  - Paged listing/search.
  - Returns `AppConversationPage`:
    - `items: AppConversation[]`
    - `next_page_id: string | null`

**Legacy/compat (deprecated; used by the CLI today)**
- `GET /api/conversations`
  - Paged list.
  - Returns `ConversationInfoResultSet` (not a bare list), which contains `ConversationInfo` records.
- `GET /api/conversations/{conversation_id}`
  - Single get.
  - Returns `ConversationInfo | null`.

In V1-backed deployments, these legacy endpoints are shims that map `AppConversation` -> `ConversationInfo` (via `_to_conversation_info`), which is why they can expose:
- `ConversationInfo.url` (derived from `AppConversation.conversation_url`)
- `ConversationInfo.session_api_key` (derived from `AppConversation.session_api_key`)

### 6.3 Separation of storage in oh-tab (recommended)
Given the above, `oh-tab` likely should treat these as distinct secrets:

- **SaaS user API key** (device-flow output)
  - used to call SaaS/app-server to fetch conversation metadata

- **Runtime session API key** (per-sandbox)
  - used to call the agent-server and open WS connections

`oh-tab` stores these separately (`cloudApiKey` vs `runtimeSessionApiKey`) to avoid ambiguity.

---

## 7) Suggested low-risk validation plan (single-shot, no loops)

The goal is to validate which token works against which surface without flooding remote APIs.

1) Confirm SaaS user API key works for SaaS APIs
- `GET https://app.all-hands.dev/api/user/info` with `Authorization: Bearer <cloud_api_key>`

2) Identify how SaaS exposes nested runtime info
- Prefer V1 endpoints returning `AppConversation(conversation_url, session_api_key)`:
  - `GET /api/v1/app-conversations?ids=<uuid>&ids=<uuid>` (batch-get)
  - `GET /api/v1/app-conversations/search` (paged)
- If needed for compatibility (CLI / older clients), use legacy shim endpoints returning `ConversationInfo(url, session_api_key)`:
  - `GET /api/conversations` (paged `ConversationInfoResultSet`)
  - `GET /api/conversations/{conversation_id}` (`ConversationInfo | null`)
- In enterprise code, the nested runtime manager also constructs `AgentLoopInfo(url, session_api_key)` for internal use.

3) Once you have a nested `agent_server_url` and its `session_api_key`, validate nested runtime auth
- `GET <agent_server_url>/api/conversations/<id>` with `X-Session-API-Key: <runtime_session_api_key>`

4) WS handshake sanity (one attempt)
- Connect to the agent-server events WS using `?session_api_key=<runtime_session_api_key>`.
- Try headers-only once to confirm whether the server supports it.

Never print tokens; avoid retries/loops.

---

## 8) Open questions to resolve before changing `oh-tab-h3g`

- Does the deployed cloud agent-server accept WS header auth today?
  - Local python agent-server does **not** (per BlackCastle’s test).

- Does SaaS proxy any of the agent-server WS paths?
  - We did not find `sockets/events` routes in enterprise; the agent-sdk-ts WS path likely targets the agent-server directly.

- Which endpoint(s) should `oh-tab` call after cloud login to obtain the runtime `session_api_key` + `agent_server_url`?
  - Prefer V1 `AppConversation` endpoints:
    - `GET /api/v1/app-conversations?ids=<uuid>&ids=<uuid>` (batch-get)
    - `GET /api/v1/app-conversations/search` (paged)
  - Use legacy (deprecated) shim endpoints only for compatibility:
    - `GET /api/conversations` (paged `ConversationInfoResultSet`)
    - `GET /api/conversations/{conversation_id}` (`ConversationInfo | null`)
  - `AgentLoopInfo(url, session_api_key)` is an enterprise internal surface (not a client API contract).

---

## Appendix: Relevant Files

### OpenHands-CLI
- `~/repos/OpenHands-CLI/openhands_cli/auth/device_flow.py`
- `~/repos/OpenHands-CLI/openhands_cli/auth/login_command.py`
- `~/repos/OpenHands-CLI/openhands_cli/auth/token_storage.py`
- `~/repos/OpenHands-CLI/openhands_cli/auth/api_client.py`
- `~/repos/OpenHands-CLI/openhands_cli/cloud/conversation.py`

### Enterprise (SaaS server)
- `~/repos/odie/enterprise/saas_server.py`
- `~/repos/odie/enterprise/server/middleware.py`
- `~/repos/odie/enterprise/server/auth/saas_user_auth.py`
- `~/repos/odie/enterprise/server/routes/oauth_device.py`
- `~/repos/odie/enterprise/server/routes/user.py` (implements `/api/user/info`)
- `~/repos/odie/enterprise/server/saas_nested_conversation_manager.py`

### OpenHands app_server (V1)
- `~/repos/odie/openhands/app_server/v1_router.py`
- `~/repos/odie/openhands/app_server/app_conversation/app_conversation_models.py`
- `~/repos/odie/openhands/app_server/app_conversation/app_conversation_router.py`
- `~/repos/odie/openhands/app_server/app_conversation/live_status_app_conversation_service.py`

### OpenHands server/ (legacy V0)
- `~/repos/odie/openhands/server/listen_socket.py`
- `~/repos/odie/openhands/server/routes/manage_conversations.py` (deprecated `/api/conversations` endpoints)

### oh-tab / agent-sdk-ts
- `src/extension/cloudLoginCommand.ts`
- `src/extension/cloudLogoutCommand.ts`
- `packages/agent-sdk-ts/src/sdk/conversation/RemoteConversation.ts`
