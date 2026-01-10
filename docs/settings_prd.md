# Settings PRD (OpenHands-Tab)

Purpose: consolidate the real settings an OpenHands-Tab VS Code extension needs, grounded in agent-sdk (V1) as the source of truth. This docs the categories, specific fields, where they come from in agent-sdk, and how we should store/split them in a VS Code extension.

1) Server connection (agent-server)
- What we need in the extension
  - serverUrl: base URL of an agent-server instance the extension connects to
  - session API key (optional): sent as
    - HTTP: X-Session-API-Key header
    - WebSocket: ?session_api_key query param
- Where these settings are defined in agent-sdk
  - WebSocket endpoints: /sockets/events/{conversation_id}
    - openhands-agent-server/openhands/agent_server/sockets.py
  - HTTP routes under /api/
    - openhands-agent-server/openhands/agent_server/api.py (+ routers)
- Current extension behavior
  - Setting: openhands.serverUrl (package.json)
  - Reads SESSION_API_KEY from the VS Code host environment (if provided) and forwards it as above
  - Source: src/connection/ConnectionManager.ts

2) Conversation/Agent settings (payload to POST /api/conversations)
- What the extension POSTs (today, minimal PoC)
  - agent: { llm: {...}, tools: [...] }
  - max_iterations: number
- Where these settings are defined in agent-sdk
  - Conversation creation payload consumed by RemoteConversation / server routes
    - openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py
    - openhands-agent-server/openhands/agent_server/routes/* and models.py
- Confirmation policies (optional but supported end-to-end)
  - Types: NeverConfirm, AlwaysConfirm, ConfirmRisky(threshold: LOW|MEDIUM|HIGH, confirm_unknown: bool)
  - Files: openhands-sdk/openhands/sdk/security/confirmation_policy.py
  - RemoteConversation supports setting policy via HTTP
    - openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py (set_confirmation_policy)
  - PRD note: if we expose a policy selector, we include it in StartConversation payload or call the policy endpoint

2a) Conversation lifecycle and persistence
- Lifecycle endpoints used by the extension (today):
  - Start: POST /api/conversations
  - Pause: POST /api/conversations/{conversation_id}/pause
  - Resume: POST /api/conversations/{conversation_id}/run
- Persistence
  - Client: current conversation_id is stored in VS Code workspaceState (not a Settings value)
  - Server: conversations/events persisted under conversations_path (default workspace/conversations) per agent-server config


3) LLM settings (agent-sdk LLM model)
- Authoritative class and fields
  - File: openhands-sdk/openhands/sdk/llm/llm.py (class LLM)
  - Commonly relevant fields (superset; use only those we intend to surface):
    - model: string (e.g., litellm_proxy/anthropic/claude-sonnet-4-20250514)
    - api_key: SecretStr | None
    - base_url: string | None
    - api_version: string | None (e.g., Azure)
    - timeout: int | None (s)
    - temperature: float | None
    - top_p: float | None
    - top_k: float | None
    - max_input_tokens: int | None
    - max_output_tokens: int | None
    - native_tool_calling: bool | None
    - reasoning_effort: 'low' | 'medium' | 'high' | 'none' | None
    - caching_prompt: bool
    - disable_vision: bool | None
    - usage_id: string (defaults to 'default-llm')
  - Serialization/secret handling
    - api_key and select fields are masked by default; can be exposed with context={'expose_secrets': True}
- Current extension behavior
  - We use ONLY LLM Profiles to hold these settings per profile (see below)

3a) LLM Profiles (local alias + remote expansion)
- Motivation
  - Profiles are a small JSON file containing a reusable LLM config (model/provider/baseUrl/etc).
  - Users select a main agent profile via `openhands.llm.profileId`.
- Storage
  - Profiles live at `~/.openhands/llm-profiles/<profileId>.json`.
  - `profileId` is a file name, not a server-side identifier.
- Remote compatibility constraint
  - The agent-server `StartConversationRequest` schema is strict and currently rejects unknown fields like `llm.profile_id`.
  - Therefore, treat `openhands.llm.profileId` as a **local alias only** for now.
  - In remote mode, the extension/SDK must load the profile locally and expand it into the existing `agent.llm` payload (only server-supported fields).
  - Do **not** send `profile_id` to the server until the agent-server supports it.
- Merge rules
  - Profile config is canonical for provider/model/baseUrl/openaiApiMode and generation parameters.
  - The only remaining VS Code LLM setting is `openhands.llm.profileId`.

4) VS Code settings split (IMPLEMENTED)
- Keep simple values in VS Code Settings (configuration)
  - openhands.serverUrl: string (default: http://localhost:3000)
  - openhands.servers: array of { url: string; label?: string } (saved servers for quick selection)
  - openhands.terminal.renderProgress: boolean (default: true) — coalesce carriage-return progress in terminal output
  - openhands.llm.profileId: string | null (default: null) — selects a profile from `~/.openhands/llm-profiles` (local alias; expanded into `agent.llm` for remote mode)
    - Effective behavior: if unset/blank/invalid, the extension will auto-select a deterministic default profileId and persist it to global settings on startup (see docs/llm_profiles.md).
  - openhands.conversation.maxIterations: number (default: 50, max: 500)
  - openhands.confirmation.policy: enum ('never' | 'always' | 'risky') (default: 'never')
  - openhands.confirmation.risky.threshold: enum ('LOW' | 'MEDIUM' | 'HIGH') (default: 'MEDIUM')
  - openhands.confirmation.risky.confirmUnknown: boolean (default: true)
  - openhands.agent.enableSecurityAnalyzer: boolean (default: true)
- Store secrets in VS Code SecretStorage (never in settings.json)
  - Implemented keys:
    - openhands.sessionApiKey (used for X-Session-API-Key / WS query param)
    - openhands.llmApiKey (legacy/fallback LLM API key; remote mode sends this as `agent.llm.api_key`)
    - Provider-global keys (used by local mode, and may be referenced by profile configs):
      - OPENAI_API_KEY
      - ANTHROPIC_API_KEY
      - OPENROUTER_API_KEY
      - LITELLM_API_KEY
      - GEMINI_API_KEY
    - Per-profile override keys:
      - openhands.llmProfileApiKey.<profileId>
    - openhands.githubToken
    - openhands.hal.ttsApiKey
    - openhands.customSecret1
    - openhands.customSecret2
    - openhands.customSecret3
    - AWS credentials are plumbed in the SettingsManager + SDK payload, but not currently exposed via a “Set AWS Credentials” command/UI:
      - openhands.awsAccessKeyId
      - openhands.awsSecretAccessKey
  - Retrieval pattern in extension code
    - const sessionApiKey = await context.secrets.get('openhands.sessionApiKey')
    - const llmApiKey = await context.secrets.get('openhands.llmApiKey')
    - const openaiKey = await context.secrets.get('OPENAI_API_KEY')
    - const profileOverrideKey = await context.secrets.get('openhands.llmProfileApiKey.sonnet-45')
- Configuration UI
  - Multi-step wizard (optional) via "OpenHands: Configure" command
  - All settings accessible via VS Code Settings UI
  - LLM Profiles separate Webview View for configuring LLM profiles
- Scoping guidance
  - serverUrl: workspace-level default (Workspace/WorkspaceFolder) — can override globally
  - Secrets: always uses global VSCode SecretStorage (per machine), not synced in settings

5) Practical mapping at runtime
- Start New Conversation request body (extension → server)
  - agent.llm: built from
    - model/base_url/api_version from openhands.llm.profileId
    - api_key from SecretStorage (fallback to env for dev)
  - agent.tools: load default tools - note that it will become user-configurable for a New conversation (only new)
  - confirmation policy: include if configured via settings (else let server default)
  - max_iterations: from settings
- WebSocket URL
  - ws(s)://{serverUrl}/sockets/events/{conversation_id}
  - append ?session_api_key=... if secret present

6) What we won’t configure in the extension (but are in agent-server)
- Server-side configuration not surfaced in the extension: session_api_keys list, allow_cors_origins, static_files_path, webhooks, enable_vscode/vnc, ports
  - Rationale: these are server deployment choices; the extension only needs to connect

7) References (agent-sdk source)
- LLM model and options: openhands-sdk/openhands/sdk/llm/llm.py
- Confirmation policy types: openhands-sdk/openhands/sdk/security/confirmation_policy.py
- RemoteConversation: openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py
- Agent-server config: openhands-agent-server/openhands/agent_server/config.py
- Agent-server WS + HTTP endpoints: openhands-agent-server/openhands/agent_server/sockets.py, api.py, routes/*

8) VS Code Secret Manager and Settings UI (IMPLEMENTED)
- VS Code SecretStorage
  - API: extensionContext.secrets (stores values in OS keychain/secure store)
  - llm keys are per provider, first, and the user has the choice to override the key per profile
  - Used for: sessionApiKey, llm key for the chosen profile, AWS credentials
  - Not synced in settings.json, not checked into source control
- Settings UI capabilities
  - VS Code supports string/number/boolean and object types in configuration schemas
- Configuration commands (IMPLEMENTED)
  - OpenHands: Configure - multi-step wizard for all settings (server URL, LLM config, agent options, confirmation policy, API keys)
  - All settings also accessible via standard VS Code Settings UI
  - LLM Profiles Webview View for LLMs

9) Implementation status
- ✓ IMPLEMENTED: All proposed settings from section 4 are now implemented
- ✓ IMPLEMENTED: Settings wizard (multi-step configuration via "OpenHands: Configure" command)
- ✓ IMPLEMENTED: Secure API key storage via VS Code SecretStorage
- ✓ IMPLEMENTED: Dynamic LLM configuration - ConnectionManager builds agent.llm payload from settings
- ✓ IMPLEMENTED: Model selection and all LLM parameters are configurable
- ✓ IMPLEMENTED: Terminal integration (local mode emits terminal events from agent's tool execution)
- ✓ IMPLEMENTED: Security analyzer toggle and confirmation policies
- Settings are stored in VS Code workspace/user settings and secrets in OS keychain
- Configuration is applied when starting new conversations and *can be updated* during extension runtime
