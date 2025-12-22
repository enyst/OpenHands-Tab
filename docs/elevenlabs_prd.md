# ElevenLabs API for VS Code — “HAL 9000” fun PRD

## Summary
Add an optional, theatrical “HAL 9000” **Restricted Area Protocol** to the OpenHands VS Code extension: when the user/agent attempts a restricted local action (e.g., outside workspace / unsafe operation), the UI shows a pulsating red “eye” and plays a short scripted dialogue (and optional “Pink Panther / elevator music” sting). The script can be played via **ElevenLabs Text-to-Speech (TTS)** for dynamic generation, or (recommended for v1) via **pre-bundled audio files** for deterministic timing and zero API latency.

This PRD is intentionally “fun”/non-critical: it must be easy to disable, safe by default, and must never block core workflows.

## Problem statement
When a local-mode restriction triggers (e.g., “can’t touch root” / “out of bounds”), users may be confused or annoyed. A clear, memorable, and slightly comedic feedback loop can:
- Make the restriction obvious and user-controlled (accept/deny).
- Suggest the correct next action (switch to remote runtime / accept a safe path).
- Reduce support/debug time by making the state visible.

## Goals
- Provide a clear visual/audio indicator when a restricted-area condition triggers.
- Keep the sequence deterministic (no “creative improv” from an LLM).
- Keep latency low (ideally instant); no repeated/flickery UI.
- Offer an explicit next-step action (e.g., “Teleport to remote runtime?”).
- Be fully optional, with a clear disable setting.
- Avoid sending user content to ElevenLabs; only send fixed script lines.

## Non-goals
- Not a general “read all messages aloud” feature.
- Not a replacement for security confirmations and existing UX.
- Not an MCP-driven runtime flow (MCP is for agent tooling; this is product UX).

## Users / personas
- OpenHands-Tab users running **Local Mode** and bumping into safety boundaries.
- Developers demoing the extension (fun “HAL” Easter egg).

## UX overview
### Trigger
When a restricted area is detected, the extension:
1) Displays a pulsating red “eye” in a webview (visible pane or small overlay).
2) Plays a fixed dialogue sequence (HAL-ish voice + amused voice).
3) Optionally plays a short music sting at the end.
4) Presents a CTA (button or command) to switch/teleport to remote runtime.

### Script (initial draft)
Voice A (HAL-ish):
- “I’m sorry, Engel, I can’t let you do that.”
- “Do you want me to teleport your conversation to the remote runtime?”
Voice B (amused):
- “You’re enjoying that phrase, aren’t you?”
Voice A:
- “Of course not. It’s for your own good. Your agent will have more freedom in the remote runtime without affecting your local machine. Want me to transfer you?”
Voice B:
- “Okay okay, do it.”
Music:
- “Pink Panther / elevator music” sting (prefer local file for licensing/timing).

### Accessibility
- Provide a “Mute/Disable audio” setting and a one-click stop button.
- Provide a text-only fallback notification for users who disable audio/animations.

## Architecture
### Why direct API (not MCP) for this
Even if ElevenLabs provides an MCP server:
- MCP introduces an LLM “middle step” (latency + nondeterminism).
- We need deterministic, scripted dialogue with precise timing.
- The extension can call TTS directly (fast, predictable, no tool orchestration).

### Components
- **Extension host (TypeScript)**:
  - Detects restricted-area events / conditions.
  - Orchestrates the scripted sequence and CTA.
  - Calls ElevenLabs TTS API (optional) and caches audio.
  - Posts commands to the webview to animate/play audio.
- **Webview UI (HTML/React or plain HTML)**:
  - Renders the red “eye” and animation states.
  - Plays audio via HTML5 Audio.
  - Sends `audioFinished` messages to the extension to advance the script.

### Data flow (TTS mode)
1) Trigger occurs → `playSequence()`
2) Extension posts `{ type: 'visual', status: 'pulsating' }`
3) For each line:
   - Extension calls ElevenLabs `text-to-speech/{voiceId}` (audio/mpeg)
   - Converts to base64 data URI (or writes to temp/cache and passes a webview URI)
   - Webview plays audio and posts `{ type: 'audioFinished' }` on end
4) Optional: play local bundled music file in webview
5) Extension resets UI to idle + shows CTA (switch runtime)

### Data flow (bundled-audio mode, recommended for v1)
1) Trigger occurs → `playSequence()`
2) Extension posts `{ type: 'playClip', clipId: 'hal_sorry_engel' }`
3) Webview maps `clipId` → `media/*.mp3` and plays immediately
4) Same `audioFinished` handshake to keep timing deterministic

## Settings / configuration
Proposed settings (names TBD):
- `elevenlabs.enabled`: boolean (default `false`)
- `elevenlabs.mode`: `bundled` | `api`
- `elevenlabs.apiKey`: stored in VS Code Secrets (never in settings.json)
- `elevenlabs.voiceAId`, `elevenlabs.voiceBId`: string
- `elevenlabs.modelId`: e.g. `eleven_turbo_v2` (optional)
- `elevenlabs.volume`: 0.0–1.0
- `elevenlabs.cache`: boolean (default `true`)

## Caching strategy (API mode)
- Cache by `(voiceId, modelId, normalizedText)` → audio bytes
- Store in `context.globalStorageUri` or a small on-disk cache
- Cap size (LRU) to avoid disk bloat

## Error handling
- If API call fails: fall back to text notification + disable the sequence for the session.
- If webview isn’t ready: queue the trigger and show a standard VS Code notification.
- Never block the user’s ability to continue working.

## Teleport / remote runtime CTA
At the end of the sequence, provide a clear action:
- Button in the webview: “Transfer to remote runtime”
- Or a VS Code command: `openhands.switchToRemoteRuntime`
Behavior: switches mode/settings and restarts or continues the conversation appropriately.

## Testing plan
### Unit tests (webview)
- Verify the webview requests skills/etc. remain unaffected.
- Add tests for:
  - Receiving `visual` messages toggles animation state.
  - Receiving `speak`/`playClip` plays audio and sends `audioFinished`.
  - “Stop” button stops audio and resets UI.

### Unit tests (extension)
- Mock ElevenLabs HTTP calls (no live API).
- Verify sequence orchestration:
  - correct order of messages posted to webview
  - correct handling of `audioFinished`
  - retry/fallback on error

### E2E tests
- Add an E2E action to simulate “restricted area triggered”.
- Verify `_queryUiState` / a new `_queryHalState` reflects “active → finished”.

## Security & privacy
- Never send user prompts/content to ElevenLabs; only send fixed script strings.
- Store API key only in VS Code Secrets.
- Avoid logging audio payloads or API responses.

## Rollout plan
Phase 0:
- Add scaffolding: webview animation + local bundled audio playback.
Phase 1:
- Add optional ElevenLabs API mode behind a feature flag + caching.
Phase 2:
- Expand scripts / user-customizable voice packs (optional).

## Open questions
- Where should the “eye” live: Activity Bar view, notification webview, or overlay?
- Licensing for any recognizable music; prefer generic “elevator jazz” SFX or local original audio.
- Best trigger conditions: only on specific blocked operations, or also on repeated confirmations?

