# Spec: Slack → GitHub Triage Service (FastAPI, Python 3.13)

## Summary
Build a FastAPI service (Python 3.13) that subscribes to Slack Events API for the Liberty Labs workspace and ingests channel + thread messages. It classifies content with an LLM, stores structured JSON records, and creates GitHub issues for unanswered threads in the most likely OpenHands repository. It then reacts to the original Slack post with :+1: to indicate completion.

## Goals
- Receive Slack Events API message payloads for channels in the Liberty Labs workspace and correctly parse message + thread structures.
- Use an LLM (env vars: `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`) to:
  1) Filter out low-content messages (e.g., “lol”, “ok”).
  2) Classify messages into categories: bug report, support request, feature request, agent research discussion, architecture / code design / refactoring / invariants discussion.
  3) Detect channel (Slack channel id/name).
  4) Detect the most likely repository among `OpenHands/OpenHands`, `OpenHands/software-agent-sdk`, `OpenHands/OpenHands-CLI`, `OpenHands/benchmarks`.
- Persist structured JSON for messages and threads with classification output and routing metadata.
- For threads without an answer, open a GitHub issue in the most likely repo, introduce the reporter as `smolpaws`, and add a :+1: reaction on the original Slack message.

## Non-goals
- Building a Slack UI, slash commands, or interactive components.
- Full multi-tenant Slack or GitHub app management (single workspace + org scope only).

## References
- Slack Events API overview and HTTP-based event delivery: <https://docs.slack.dev/apis/events-api/>
- GitHub OAuth app authorization (web + device flows): <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>

## Architecture

### Components
1. **FastAPI web server**
   - Handles Slack Events API requests.
   - Exposes GitHub OAuth endpoints (auth + callback) to get user or bot tokens for issue creation.
2. **Background worker / queue**
   - Ensures Slack request handling is fast (ack within 3s).
   - Deduplicates events and processes classification + issue creation asynchronously.
3. **Storage**
   - JSON storage in a DB (Postgres recommended, SQLite acceptable for MVP).
   - Stores message-level and thread-level records, LLM results, and issue links.

### Request Flow (Slack)
1. Slack delivers `event_callback` payloads to `/slack/events`.
2. Server verifies request signature using Slack signing secret.
3. Server returns `200 OK` immediately, enqueues processing job.
4. Worker loads thread context and channels metadata (if required), runs LLM classification, stores results, and potentially creates GitHub issues.

### Request Flow (GitHub OAuth)
1. Admin visits `/github/login` → redirects to GitHub OAuth `authorize` endpoint.
2. GitHub returns to `/github/callback` with `code` → server exchanges for access token.
3. Token is stored securely and used for issue creation.

## Slack Integration

### Slack App Configuration
- **Event Subscriptions**: enable and set `Request URL` to `https://<host>/slack/events`.
- **Required Scopes**:
  - `channels:history` (read channel messages)
  - `channels:read` (resolve channel names)
  - `groups:history` (if private channels used)
  - `reactions:write` (add :+1: reaction)
  - `users:read` (resolve user ids)
- **Bot Token**: store in `SLACK_BOT_TOKEN`.
- **Signing Secret**: store in `SLACK_SIGNING_SECRET`.

### Events to Subscribe
- `message.channels` (for public channels).
- `message.groups` (for private channels, if needed).

### Request Verification
- Validate signature per Slack docs:
  - Use `X-Slack-Signature` and `X-Slack-Request-Timestamp`.
  - Reject requests older than a small window (e.g., 5 minutes) to prevent replay.

### Handling URL Verification
- If payload `type` is `url_verification`, respond with `{"challenge": "<value>"}`.

### Message Parsing Rules
- Ignore bot messages from this app (avoid loops) unless explicitly required.
- Use Slack `thread_ts` to group thread replies under a parent.
- Store both the **root message** and **all replies** (with text + metadata) for classification context.
- Store Slack canonical permalink for the root message for issue linking.

## GitHub Integration

### GitHub App
- Use a GitHub App instead of an OAuth app for more granular permissions and enhanced security.
- The app will need `issues:write` permission, which can be granted on a per-repository basis during installation.
- The service will authenticate as an installation of the app to create issues.
- Store GitHub App credentials securely:
  - `GITHUB_APP_ID`
  - `GITHUB_INSTALLATION_ID`
  - `GITHUB_PRIVATE_KEY`

### Required App Permissions
- `issues: write` (to create issues in repositories where the app is installed)

### Issue Creation Policy
- Pick the most likely repo based on LLM classification + heuristics.
- Create issue with intro:
  - Start issue body with: `Hi, I’m smolpaws and I’m summarizing a Slack discussion from Liberty Labs.`
- Add a link back to Slack thread permalink.

### Reactions to Slack
- After successful issue creation, add `:+1:` reaction to the root Slack message.

## LLM Classification

### Inputs
- Message text + thread context (root + replies).
- Channel metadata (name, topic).
- Optional: message attachments and blocks, summarized to text.

### Output Schema
LLM should return JSON with:
```json
{
  "low_content": false,
  "categories": ["bug_report", "support_request"],
  "channel": {
    "id": "C12345",
    "name": "openhands"
  },
  "repository": {
    "org": "OpenHands",
    "name": "OpenHands",
    "confidence": 0.78,
    "candidates": [
      {"name": "OpenHands", "score": 0.78},
      {"name": "software-agent-sdk", "score": 0.12},
      {"name": "OpenHands-CLI", "score": 0.06},
      {"name": "benchmarks", "score": 0.04}
    ]
  },
  "rationale": "Mentions webview bug in OpenHands tab; references extension UI."
}
```

### Category Definitions
- `bug_report`: Something broken or incorrect.
- `support_request`: User asking for help or how-to guidance.
- `feature_request`: Asking for new functionality or enhancement.
- `agent_research`: Discussion about agents, research, or experiments.
- `architecture_discussion`: Discussion of code design, refactoring, or invariants.

### Low-Content Filtering
- Always filter messages containing only short acknowledgements (e.g., “ok”, “lol”, “thanks”).
- Provide a deterministic fallback regex to short-circuit LLM calls.

## Unanswered Thread Detection

### Definition
A thread is “unanswered” when:
- The root message is not authored by the bot.
- No reply in the thread is authored by a maintainer or bot and contains substantive content.
- The thread does not already have a linked GitHub issue in storage.

### Suggested Heuristics
- Maintain a list of maintainer Slack user ids.
- Consider any reply over a length threshold (e.g., 50 chars) as substantive.
- Allow manual override via an allowlist/denylist in config.

## Data Model (JSON)

### Message Record
```json
{
  "slack_event_id": "Ev123",
  "slack_channel_id": "C123",
  "slack_channel_name": "openhands",
  "slack_message_ts": "1700000000.1234",
  "slack_thread_ts": "1700000000.1234",
  "slack_user_id": "U123",
  "text": "Bug report text...",
  "permalink": "https://...",
  "classification": { ... },
  "created_at": "2025-01-01T00:00:00Z"
}
```

### Thread Record
```json
{
  "slack_thread_ts": "1700000000.1234",
  "slack_channel_id": "C123",
  "root_message": { ... },
  "replies": [ ... ],
  "classification": { ... },
  "unanswered": true,
  "github_issue": {
    "repo": "OpenHands/OpenHands",
    "issue_number": 1234,
    "url": "https://github.com/OpenHands/OpenHands/issues/1234"
  },
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:10:00Z"
}
```

## API Endpoints

### Slack
- `POST /slack/events`
  - Accepts Slack event callbacks.
  - Handles `url_verification`.
  - Validates signature.
  - Enqueues processing job.

### GitHub OAuth
- `GET /github/login` → redirects to GitHub OAuth authorize endpoint.
- `GET /github/callback` → exchanges code for token, stores token.

### Health
- `GET /healthz` → simple uptime check.

## Background Processing
- Use a job queue (e.g., Redis + RQ/Celery) or FastAPI BackgroundTasks for MVP.
- Deduplicate Slack events using `event_id` and `event_time`.
- Fetch missing thread context via `conversations.replies` as needed.

## Configuration

### Environment Variables
- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN` (if Socket Mode is later added)
- `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`
- `DATABASE_URL`

## Observability
- Log request ids, Slack event ids, GitHub issue ids.
- Metrics: events received, events processed, issues created, LLM latency, failures.

## Security Considerations
- Verify Slack signatures and replay timestamps.
- Store OAuth tokens encrypted at rest.
- Avoid logging message content unless redacted.

## Open Questions
- Should we prefer a GitHub App for better permissions and short-lived tokens?
- Which Slack channels should be included by default? Should this be configured by allowlist?
