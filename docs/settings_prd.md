# Settings PRD (OpenHands-Tab)

Purpose: document the *actual* settings used by the OpenHands-Tab VS Code extension today. This is grounded in the TypeScript agent SDK (`@openhands/agent-sdk-ts`) and the extension implementation as the source of truth.

## 1) Server connection (agent-server)

### VS Code settings
- `openhands.serverUrl` (string, default: empty)
  - Empty → local mode (SDK runs in-process).
  - Non-empty → remote mode (agent-server over HTTP/WebSocket).
  - Normalization: if the user omits a scheme, the extension coerces it to `http://…` and canonicalizes the URL.
- `openhands.servers` (array of `{ url, label? }`)
  - Stored globally.
  - Deduplicated by canonical URL; invalid entries are dropped.
  - If `serverUrl` is set, it is always injected into the saved server list.

### Secrets
- `openhands.cloudApiKey.server.<hash>` (VS Code SecretStorage; per-server)
  - Used only for OpenHands Cloud/SaaS servers (e.g. `https://app.all-hands.dev`).
  - HTTP header: `Authorization: Bearer <cloudApiKey>`
- `openhands.runtimeSessionApiKey.server.<hash>` (VS Code SecretStorage; per-server)
  - Used for agent-server endpoints (local python server or nested cloud runtime agent-server).
  - HTTP header: `X-Session-API-Key: <runtimeSessionApiKey>`
  - WebSocket query param: `?session_api_key=<runtimeSessionApiKey>`

## 2) Conversation lifecycle & persistence

### Conversation IDs
- Stored in workspace state:
  - `openhands.conversationId.local`
  - `openhands.conversationId.remote`

### Persistence (local mode only)
- `openhands.conversation.storeRoot` (string, optional)
  - When set, treated as a path relative to the user’s home directory unless absolute.
  - If empty, the extension falls back to `~/.openhands/conversations-vscode/`.
  - If that fails (e.g., permission), it tries VS Code global storage, then OS temp.

### Limits
- `openhands.conversation.maxIterations` (number, default: 50)
  - Applied to new conversations via the SDK.

## 3) LLM settings: profiles are the single source of truth

### VS Code setting
- `openhands.llm.profileId` (string, machine scope)
  - A *local alias* that points to `~/.openhands/llm-profiles/<profileId>.json`.
  - If unset/invalid, the extension auto-selects a default profile ID and persists it globally. The selection order is:
    1) A profile that already has a per-profile API key stored in SecretStorage.
    2) A profile suggested by provider-specific API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`).
    3) The fallback profile ID `sonnet-45`.
- `openhands.oracle.profileId` (string, machine scope)
  - Optional. Selects the LLM profile used by the local-only `ask_oracle` tool.
  - If unset, `ask_oracle` returns an instructive error prompting you to configure it.

### Profile expansion (remote compatibility)
- The agent-server schema is strict; it does **not** accept `profile_id` fields.
- The extension loads the profile locally and expands it into `agent.llm` fields before sending remote requests.

### LLM fields expanded from profiles
The extension reads these fields from the profile and passes them to the SDK:
- `provider`, `model`, `openaiApiMode`, `baseUrl`, `apiVersion`
- `timeoutSeconds`, `temperature`, `topP`, `topK`
- `maxInputTokens`, `maxOutputTokens`
- `reasoningEffort`, `reasoningSummary`
- `inputCostPerToken`, `outputCostPerToken`

### Per-profile API keys
- Stored in SecretStorage as `openhands.llmProfileApiKey.<profileId>`.

## 4) Agent & dev settings

- `openhands.agent.enableSecurityAnalyzer` (bool, default: true)
- `openhands.agent.debug` (bool, default: false)
  - Enables local-mode debug events (e.g., `llm_request` / `tool_call_raw`).
- `openhands.agent.summarizeToolCalls` (bool, default: false)
  - Local-only. Generates Gemini summaries for tool calls.
  - Auto-disabled if no Gemini API key is available.
- `openhands.devBridge.enabled` (bool, default: false)
  - Enables the webview → extension debug logging bridge.

## 5) Confirmation policy

- `openhands.confirmation.policy` = `never | always | risky`
- `openhands.confirmation.risky.threshold` = `LOW | MEDIUM | HIGH`
- `openhands.confirmation.risky.confirmUnknown` = boolean

These values map directly to the SDK confirmation policy and drive the confirmation UI.

## 6) HAL (high-risk confirmation flow)

- `openhands.hal.enabled` (bool, default: false)
- `openhands.hal.mode` = `bundled | tts_only | voice_confirm`
- `openhands.hal.userName` (string, default: `Engel`)
- `openhands.hal.llmProfileId` (string, default: `gemini-flash-hal`)
- `openhands.hal.voiceAId`, `openhands.hal.voiceUserId`, `openhands.hal.modelId`
- `openhands.hal.volume` (0.0–1.0)
- `openhands.hal.cache` (bool)

## 7) Secrets and storage

Secrets are stored in VS Code SecretStorage and never in `settings.json`:

**Extension-scoped secrets (SecretStorage keys)**
- `openhands.cloudApiKey.server.<hash>`
- `openhands.runtimeSessionApiKey.server.<hash>`
- `openhands.llmApiKey` (global fallback LLM API key)
- `openhands.awsAccessKeyId`, `openhands.awsSecretAccessKey` (plumbed but no dedicated UI)
- `openhands.githubToken`
- `openhands.hal.ttsApiKey`
- `openhands.customSecret1`, `openhands.customSecret2`, `openhands.customSecret3`
- `openhands.llmProfileApiKey.<profileId>`

**Provider keys stored in SecretStorage**
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `LITELLM_API_KEY`, `GEMINI_API_KEY`

**Important: “secrets” settings are *status indicators only***
The following VS Code settings exist only to display ✓/blank status in the Settings UI:
- `openhands.secrets.*` (`cloudApiKey`, `runtimeSessionApiKey`, `githubToken`, provider keys, custom secrets)

These do **not** store secrets; they are updated automatically when SecretStorage changes.

## 8) Configuration UI & commands

- **OpenHands: Configure** → opens the extension Settings page.
- **Secret commands** prompt for values and store them securely:
  - `OpenHands: Set API Key` (global fallback key: `openhands.llmApiKey`)
  - Provider-specific keys: OpenAI, Anthropic, OpenRouter, LiteLLM, Gemini
  - Cloud API key, Runtime Session API key, GitHub token, HAL TTS key, Custom secrets 1–3
  - **LLM Profiles view** (webview slide-over) for profile CRUD and per-profile keys.

## 9) Runtime mapping

- Local mode (no `serverUrl`):
  - SDK runs in-process with local tools + `AgentContext` (skills enabled).
- Remote mode (with `serverUrl`):
  - SDK connects to agent-server; `agent.llm` is populated from the selected profile and `llmApiKey` fallback.
- WebSocket URL: `ws(s)://{serverUrl}/sockets/events/{conversation_id}` with optional `session_api_key`.

## 10) What is intentionally *not* surfaced

Server deployment settings such as CORS, server-side persistence paths, session key lists, and VNC/port management are server concerns and not exposed in the extension UI.
