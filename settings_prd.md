# Settings PRD (OpenHands-Tab)

Purpose: consolidate the real settings an OpenHands-Tab VS Code extension needs, grounded in agent-sdk (V1) as the source of truth. This docs the categories, specific fields, where they come from in agent-sdk, and how we should store/split them in a VS Code extension.

1) Server connection (agent-server)
- What we need in the extension
  - serverUrl: base URL of an agent-server instance the extension connects to
  - session API key (optional): sent as
    - HTTP: X-Session-API-Key header
    - WebSocket: ?session_api_key query param
- Where this comes from in agent-sdk
  - WebSocket endpoints: /sockets/events/{conversation_id}
    - openhands-agent-server/openhands/agent_server/sockets.py
  - HTTP routes under /api/
    - openhands-agent-server/openhands/agent_server/api.py (+ routers)
  - Config fields on the server (for reference; the extension doesn’t set these):
    - session_api_keys, allow_cors_origins, conversations_path, bash_events_dir, static_files_path, webhooks, enable_vscode, vscode_port, enable_vnc
    - File: openhands-agent-server/openhands/agent_server/config.py
- Current extension behavior
  - Setting: openhands.serverUrl (package.json)
  - Reads SESSION_API_KEY from the VS Code host environment (if provided) and forwards it as above
  - Source: src/connection/ConnectionManager.ts

2) Conversation/Agent settings (payload to POST /api/conversations)
- What the extension POSTs (today, minimal PoC)
  - agent: { llm: {...}, tools: [...] }
  - max_iterations: number
- Where this comes from in agent-sdk
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
  - Resume: POST /api/conversations/{conversation_id}/resume
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
    - seed: int | None
    - safety_settings: list[dict[str, str]] | None
    - usage_id: string (defaults to 'default')
    - metadata: dict[str, any]
  - Serialization/secret handling
    - api_key and select fields are masked by default; can be exposed with context={'expose_secrets': True}
- Current extension behavior
  - Hardcoded defaults in ConnectionManager when starting a conversation
    - model: litellm_proxy/anthropic/claude-sonnet-4-20250514
    - base_url: https://llm-proxy.eval.all-hands.dev
    - api_key: from env (LITELLM_API_KEY or OPENAI_API_KEY)
  - No UI to change model/params yet (noted in PR_DESCRIPTION.md)

4) Proposed VS Code settings split
- Keep simple values in VS Code Settings (configuration)
  - openhands.serverUrl: string (already exists)
  - openhands.llm.model: string (default model name)
  - openhands.llm.baseUrl: string | null
  - openhands.llm.apiVersion: string | null
  - openhands.llm.temperature: number | null
  - openhands.llm.topP: number | null
  - openhands.llm.maxOutputTokens: number | null
  - openhands.conversation.maxIterations: number (default for new conversations)
  - openhands.confirmation.policy: enum ('never' | 'always' | 'risky')
  - openhands.confirmation.risky.threshold: enum ('LOW' | 'MEDIUM' | 'HIGH')
  - openhands.confirmation.risky.confirmUnknown: boolean
- Store secrets in VS Code SecretStorage (never in settings.json)
  - keys suggested:
    - openhands.sessionApiKey (used for X-Session-API-Key / WS query param)
    - openhands.llm.apiKey
  - Retrieval pattern in extension code
    - const sessionApiKey = await context.secrets.get('openhands.sessionApiKey')
    - const llmApiKey = await context.secrets.get('openhands.llm.apiKey')
- Advanced overrides for LLM (complex/nested)
  - Use a single JSON-typed setting for advanced fields that map 1:1 to agent-sdk LLM
    - openhands.llm.extra: string (JSON). Example:
      {
        "native_tool_calling": true,
        "reasoning_effort": "high",
        "safety_settings": [{"category": "HATE", "threshold": "medium"}]
      }
  - Merge strategy when starting a conversation:
    - Begin with curated fields from settings
    - Merge in parsed llm.extra (ignore unknowns)
    - Apply secrets from SecretStorage last (api_key)
- Scoping guidance
  - serverUrl: workspace-level default (Workspace/WorkspaceFolder), can override globally
  - LLM defaults: user-level defaults, overridable per workspace
  - Secrets: always global SecretStorage (per machine), not synced in settings

5) Practical mapping at runtime
- Start New Conversation request body (extension → server)
  - agent.llm: built from
    - model/base_url/api_version from settings
    - api_key from SecretStorage (fallback to env for dev)
    - selected curated numeric params (temperature, top_p, max_output_tokens)
    - merged extras from openhands.llm.extra
  - agent.tools: unchanged (extension-defined)
  - confirmation policy: include if configured via settings (else let server default)
  - max_iterations: from settings
- WebSocket URL
  - ws(s)://{serverUrl}/sockets/events/{conversation_id}
  - append ?session_api_key=... if secret present

6) What we won’t configure in the extension (but are in agent-server)
- Server’s own config: session_api_keys list, allow_cors_origins, conversations_path, bash_events_dir, static_files_path, webhooks, enable_vscode/vnc, ports
  - Rationale: these are server deployment choices; the extension only needs to connect

7) References (agent-sdk source)
- LLM model and options: openhands-sdk/openhands/sdk/llm/llm.py
- Confirmation policy types: openhands-sdk/openhands/sdk/security/confirmation_policy.py
- RemoteConversation: openhands-sdk/openhands/sdk/conversation/impl/remote_conversation.py
- Agent-server config: openhands-agent-server/openhands/agent_server/config.py
- Agent-server WS + HTTP endpoints: openhands-agent-server/openhands/agent_server/sockets.py, api.py, routes/*

8) Notes on VS Code Secret Manager and Settings UI
- VS Code SecretStorage
  - API: extensionContext.secrets (stores values in OS keychain/secure store)
  - Good for: sessionApiKey, llm.apiKey, any provider credentials
  - Not synced in settings.json, not checked into source control
- Settings UI capabilities
  - VS Code supports string/number/boolean and object types in configuration schemas
  - For complex LLM options, two-tier approach recommended:
    1) Curated simple keys for the common 90%
    2) Single JSON pass-through for advanced fields
- UX options for configuration
  - Provide commands:
    - OpenHands: Configure Server URL (existing)
    - OpenHands: Configure LLM… (opens a JSON editor or quick form)
    - OpenHands: Set Session API Key (writes to SecretStorage)

9) Immediate deltas vs current repo
- Today, only openhands.serverUrl is surfaced; ConnectionManager hardcodes model and base_url and pulls api key from env
- Next steps (not implemented here): wire settings + secrets to build agent.llm payload dynamically and expose model selection per PR_DESCRIPTION.md
