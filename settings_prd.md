# OpenHands-Tab Settings PRD

## Overview
This document details the settings requirements for the OpenHands-Tab VS Code extension. Settings are derived from the real agent-sdk requirements and organized by complexity and use case.

## Settings Categories (from agent-sdk)

### 1. Connection Settings
**Where**: VS Code Settings (simple key-value pairs)

- `openhands.serverUrl` (string, default: `http://localhost:3000`)
  - The base URL of the OpenHands agent-server
  - Example: `http://localhost:3000`, `https://openhands.company.com`

- `openhands.sessionApiKey` (secret)
  - Optional session API key for authenticated requests
  - Stored in VS Code SecretStorage
  - If set, included as `X-Session-API-Key` header (HTTP) or `?session_api_key=...` query param (WebSocket)

### 2. LLM Settings
**Where**: TBD - see Architecture Discussion below

These settings configure the Language Model used by the agent. From `openhands.sdk.llm.llm.LLM`:

#### Core LLM Configuration
- `model` (string, default: `claude-sonnet-4-20250514`)
  - Model name in litellm format
  - Examples: `claude-sonnet-4-20250514`, `gpt-4o`, `azure/gpt-4`, `ollama/llama3`

- `api_key` (secret)
  - API key for the LLM provider
  - Provider-specific: OpenAI, Anthropic, Azure, etc.

- `base_url` (string, optional)
  - Custom base URL for API requests
  - Example: `https://api.openai.com/v1` (custom proxy)

- `api_version` (string, optional)
  - API version (primarily for Azure)
  - Example: `2024-02-15-preview`

#### AWS-specific Settings (for Bedrock)
- `aws_access_key_id` (secret)
- `aws_secret_access_key` (secret)
- `aws_region_name` (string)

#### Sampling Parameters
- `temperature` (float, default: 0.0, range: 0-2)
  - Controls randomness in responses

- `top_p` (float, default: 1.0, range: 0-1)
  - Nucleus sampling threshold

- `top_k` (float, optional, range: 0+)
  - Top-k sampling (provider-specific)

- `max_output_tokens` (int, optional)
  - Maximum tokens in model response
  - Maps to `max_completion_tokens` (OpenAI) or `max_tokens` (Azure)

#### Advanced LLM Features
- `reasoning_effort` (enum: `low` | `medium` | `high` | `none`, optional)
  - For reasoning models (o1, o3, gemini-2.5-pro, etc.)
  - Gemini 2.5-pro defaults to `low` if not set

- `extended_thinking_budget` (int, default: 200000)
  - Budget tokens for extended thinking (Anthropic models)
  - Enables interleaved thinking with `anthropic-beta` header

- `seed` (int, optional)
  - Random seed for reproducibility

- `safety_settings` (list of objects, optional)
  - Safety settings for Mistral/Gemini models

- `custom_llm_provider` (string, optional)
  - Custom provider name for litellm

- `ollama_base_url` (string, optional)
  - Base URL for Ollama models

#### Token & Cost Limits
- `max_input_tokens` (int, optional)
  - Currently unused; informational only

- `input_cost_per_token` (float, optional)
  - Cost per input token (for logging/tracking)

- `output_cost_per_token` (float, optional)
  - Cost per output token (for logging/tracking)

#### Retry & Timeout
- `timeout` (int, optional, seconds)
  - HTTP request timeout

- `num_retries` (int, default: 5)
  - Number of retries on failure

- `retry_multiplier` (float, default: 8.0)
- `retry_min_wait` (int, default: 8, seconds)
- `retry_max_wait` (int, default: 64, seconds)

#### Behavioral Flags
- `native_tool_calling` (bool, optional)
  - Whether to use native tool calling if supported

- `caching_prompt` (bool, default: true)
  - Enable prompt caching (if supported by provider)

- `disable_vision` (bool, optional)
  - Disable vision capabilities (cost reduction)

- `disable_stop_word` (bool, default: false)

- `drop_params` (bool, default: true)
  - Let litellm drop unsupported params

- `modify_params` (bool, default: true)
  - Let litellm transform params

- `log_completions` (bool, default: false)
  - Log LLM completions to disk

- `log_completions_folder` (string)
  - Where to log completions (if enabled)

- `custom_tokenizer` (string, optional)
  - Custom tokenizer for token counting

- `enable_encrypted_reasoning` (bool, default: false)
  - Request encrypted reasoning content (Responses API)

#### Metadata
- `usage_id` (string, default: `default`)
  - Unique identifier for telemetry/spend tracking

- `metadata` (dict, optional)
  - Additional metadata (trace_version, tags, session_id, trace_user_id, etc.)

### 3. Conversation & Agent Settings
**Where**: TBD - see Architecture Discussion below

From `StartConversationRequest` in agent-server/models.py:

#### Confirmation Policy
Controls when the agent prompts for user approval before executing actions.

- `confirmation_policy` (discriminated union, default: `NeverConfirm`)
  - **NeverConfirm**: Never ask for confirmation
  - **AlwaysConfirm**: Always ask before executing any action
  - **ConfirmRisky**: Ask based on risk level
    - `threshold` (enum: `LOW` | `MEDIUM` | `HIGH`)
      - Actions at or above this risk level require confirmation
    - `confirm_unknown` (bool, default: true)
      - Whether to confirm actions with unknown risk

#### Agent Execution
- `max_iterations` (int, default: 500, min: 1)
  - Maximum iterations before stopping (prevents infinite loops)

- `stuck_detection` (bool, default: true)
  - Enable stuck detection to prevent infinite loops

#### Tools
- `tools` (list of Tool specs)
  - Tools available to the agent
  - Common defaults: `BashTool`, `FileEditorTool`, `TaskTrackerTool`
  - Note: From agent-sdk, tools can be simple names or full configurations

#### Secrets
- `secrets` (dict of SecretSource)
  - Secrets available to the agent
  - Used by bash tool env_provider
  - Automatically masked in outputs

### 4. Workspace Settings
**Where**: VS Code Settings (simple)

- `openhands.workingDir` (string, default: current workspace root)
  - Working directory for agent operations
  - Defaults to VS Code workspace folder

### 5. Persistence Settings
**Where**: VS Code Settings (simple)

- `openhands.persistenceEnabled` (bool, default: true)
  - Whether to persist conversations to disk

- `openhands.conversationsPath` (string, default: `~/.openhands/conversations`)
  - Where to store conversation data
  - From agent-server config: `conversations_path`

## Architecture Discussion: How to Split Settings

### The Challenge
VS Code provides a built-in Settings UI that works well for simple key-value pairs, but:
1. **VS Code settings are flat** - each setting is a simple value (string, number, boolean, array, object)
2. **Some of our settings are complex** - e.g., LLM config has 40+ parameters, confirmation policy is a discriminated union
3. **VS Code has SecretStorage API** - for sensitive values like API keys

### Option 1: All Settings in VS Code Settings
**Pros**:
- Familiar UI for users
- Standard VS Code workflow
- Settings sync across machines
- Search and discovery built-in

**Cons**:
- Flat structure makes complex settings awkward
  - Example: `"openhands.llm.model"`, `"openhands.llm.apiKey"`, `"openhands.llm.temperature"`, etc.
- 40+ LLM settings would clutter the settings UI
- Discriminated unions (like confirmation_policy) are awkward
- Hard to validate related settings together

### Option 2: Hybrid - Simple in VS Code Settings, Complex in Custom UI
**Recommended Approach**

#### VS Code Settings (Simple, Stable):
- `openhands.serverUrl`
- `openhands.sessionApiKey` (SecretStorage)
- `openhands.workingDir`
- `openhands.persistenceEnabled`
- `openhands.conversationsPath`
- `openhands.defaultLlmProfile` (string reference to profile name)

#### Custom Settings UI in Webview/Tab (Complex, Dynamic):
- **LLM Profiles**: Named configurations (e.g., "Claude Sonnet 4", "GPT-4o", "Local Ollama")
  - Each profile contains all LLM settings
  - Users can create/edit/delete/switch profiles
  - Profiles stored as workspace settings or global settings JSON
  - Current profile selected via `openhands.defaultLlmProfile`

- **Confirmation Policy UI**:
  - Radio buttons: Never / Always / Risky
  - If Risky selected: dropdown for threshold + checkbox for confirm_unknown

- **Tools Configuration**:
  - Checkboxes for common tools
  - Advanced: JSON editor for custom tool configs

**Pros**:
- Simple settings remain in familiar VS Code UI
- Complex settings get custom validation and better UX
- Can show presets/templates for LLM configs
- Can validate settings together (e.g., Azure requires api_version)

**Cons**:
- More implementation work
- Settings in two places (might confuse users)
- Custom UI doesn't sync via VS Code settings sync (unless we store in workspace settings JSON)

### Option 3: All Settings in Custom UI
**Pros**:
- Complete control over UX
- Can group related settings
- Can show help text and examples inline

**Cons**:
- Loses VS Code settings familiarity
- No built-in search/discovery
- More work to implement
- Doesn't integrate with VS Code settings sync

### VS Code Secret Management
VS Code provides `SecretStorage` API for storing secrets:
- **API**: `context.secrets.store(key, value)` / `context.secrets.get(key)`
- **Storage**: Platform-specific secure storage (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux)
- **Scope**: Can be workspace-specific or global
- **Usage**: We should use this for:
  - `openhands.sessionApiKey`
  - LLM `api_key`
  - AWS credentials (`aws_access_key_id`, `aws_secret_access_key`)
  - Any other secrets in LLM profiles

**Note**: Secrets are separate from Settings - they don't appear in settings.json. We reference them by key name.

## Recommendation Summary

### Phase 1 (MVP - Current State)
- ✅ VS Code setting: `openhands.serverUrl`
- ✅ SecretStorage: `openhands.sessionApiKey` (if needed)
- Hardcoded: LLM model (currently `claude-sonnet-4`)
- Hardcoded: Tools, confirmation policy, etc.

### Phase 2 (Settings UI - Proposed)
1. **Add VS Code Settings** (simple values):
   - `openhands.workingDir`
   - `openhands.persistenceEnabled`
   - `openhands.conversationsPath`
   - `openhands.defaultLlmProfile` (reference to profile name)

2. **Add Custom Settings UI in Tab/Webview**:
   - LLM Profiles manager
     - Create/Edit/Delete named profiles
     - Each profile = full LLM config (model, api_key via SecretStorage, temperature, etc.)
     - Show common presets: "Claude Sonnet 4", "GPT-4o", "Local Ollama", etc.
     - Store profiles in workspace settings as `openhands.llmProfiles` (array of objects)

   - Confirmation Policy UI
     - Radio buttons + conditional inputs

   - Tools Configuration
     - Checkboxes for common tools
     - Advanced JSON editor for custom configs

   - Agent Settings
     - `max_iterations`, `stuck_detection`

3. **Settings Gear Button in Tab Header**:
   - Opens settings modal/panel in webview
   - Shows current LLM profile, confirmation policy, tools
   - "Advanced" section for rarely-changed settings

### Storage Strategy
- **VS Code Settings** (`settings.json`): Simple, stable settings
- **VS Code SecretStorage**: All API keys and secrets
- **Workspace Settings JSON**: LLM profiles, complex configs (via `workspace.getConfiguration()`)
- This gives us:
  - Security for secrets
  - Sync for simple settings
  - Flexibility for complex configs
  - Workspace-specific overrides if needed

## Open Questions
1. Should LLM profiles be workspace-specific or global?
   - **Recommendation**: Global by default, with workspace override support

2. Should we expose all 40+ LLM settings, or just the most common ~10?
   - **Recommendation**: Show common settings by default, "Advanced" section for the rest

3. Should users be able to switch LLM mid-conversation?
   - **agent-sdk support**: Currently not supported - would require creating new conversation
   - **Recommendation**: Phase 3 - "Switch Model" creates new conversation with same history

4. Should we support multiple agent-server connections?
   - **Recommendation**: Phase 3+ - allow multiple server profiles (similar to LLM profiles)

## References
- agent-sdk: `/tmp/agent-sdk/openhands-sdk/openhands/sdk/llm/llm.py` (LLM class)
- agent-sdk: `/tmp/agent-sdk/openhands-agent-server/openhands/agent_server/config.py` (server config)
- agent-sdk: `/tmp/agent-sdk/openhands-agent-server/openhands/agent_server/models.py` (StartConversationRequest)
- agent-sdk: `/tmp/agent-sdk/openhands-sdk/openhands/sdk/security/confirmation_policy.py` (policies)
- agent-sdk: `/tmp/agent-sdk/openhands-sdk/openhands/sdk/conversation/state.py` (ConversationState)
