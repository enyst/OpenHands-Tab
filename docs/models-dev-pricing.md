# models.dev pricing ingestion

This repo uses [models.dev](https://models.dev) as a best-effort source of per-model pricing metadata so we can estimate conversation cost when the underlying LLM provider does not return explicit cost values.

## Data source

- Endpoint: `https://models.dev/api.json`
- Source repo: `sst/models.dev` (MIT-licensed)
- Units: `cost.input` / `cost.output` are USD per **1M tokens**

## Mapping rules

We map `@smolpaws/agent-sdk` `LLMProvider` → models.dev provider id:

- `openai` → `openai`
- `anthropic` → `anthropic`
- `gemini` → `google`
- `openrouter` → `openrouter`
- `litellm_proxy` → (no stable mapping; skip)

Model IDs are matched case-insensitively within the provider’s `models` map.

## Caching + failure modes

The SDK caches the full `api.json` response under `~/.openhands/cache/` using:

- a TTL (24h), and
- `ETag` conditional requests (`If-None-Match`) when refreshing.

If fetch/parse fails, the SDK falls back to the most recent cached copy; if none exists, pricing is treated as unknown.

## Runtime behavior

For local conversations, when an LLM profile does not explicitly specify both `inputCostPerToken` and `outputCostPerToken`, the SDK will (best-effort) look up pricing via models.dev and apply the derived **per-token** rates for that session only (no auto-persist back to the profile file).

Once rates are present, `Metrics` computes `accumulatedCost` from token usage, and the webview displays the conversation’s `Total cost`.

