# ElevenLabs API for VS Code — “HAL 9000” fun PRD

## Summary
Add an optional, theatrical “HAL 9000” **Restricted Area Protocol** to the OpenHands VS Code extension: when the agent requests a confirmation with risk = `HIGH` (i.e., the same risk level shown in the confirmation UI), the chat webview overlays a pulsating red “eye” and plays a short scripted dialogue. If the user chooses “Teleport to remote runtime”, play the “Rhapsody in Blue final crescendo / elevator music” snippet while waiting for the remote conversation to be ready.

The script can be played via **ElevenLabs Text-to-Speech (TTS)** for dynamic generation, or (deferred for later, after human tests TTS workflow) via **pre-bundled audio files** for deterministic timing and zero API latency.

This PRD is intentionally “fun”/non-critical: it must be easy to disable, safe by default, and must never block core workflows.

## Problem statement
When a HIGH-risk confirmation triggers (often associated with local-mode restrictions like “can’t touch root” / “out of bounds”), users may be confused or annoyed. A clear, memorable, and slightly comedic feedback loop can:
- Make the restriction obvious and user-controlled (accept/deny).
- Suggest the correct next action (switch to remote runtime / accept a safe path).
- Reduce support/debug time by making the state visible.

## Goals
- Provide a clear visual/audio indicator when a HIGH-risk confirmation triggers.
- Keep the sequence deterministic (no “creative improv” from an LLM).
- Keep latency low (ideally instant); no repeated/flickery UI.
- Offer an explicit next-step action (e.g., “Teleport to remote runtime?”).
- Be fully optional, with a clear disable setting.
- Avoid sending user content to ElevenLabs; only send fixed script lines.

## Non-goals
- Not a general “read all messages aloud” feature.
- Not a replacement for other security confirmations and existing UX. But it should be triggered, if enabled, when security risk is HIGH.
- Not an MCP-driven runtime flow (MCP is for agent tooling; this is product UX).

## Users / personas
- OpenHands-Tab users running **Local Mode** and bumping into safety boundaries.
- Developers demoing the extension (fun “HAL” Easter egg).

## UX overview
### Trigger
When the agent requests a confirmation with risk = `HIGH` (and the feature is enabled), the extension:
1) Displays a pulsating red “eye” overlay inside the chat webview.
2) Plays a fixed dialogue sequence (HAL-ish voice + amused voice).
3) Presents a CTA (button or command) to switch/teleport to remote runtime.
4) If the user triggers the CTA, shows a “Teleporting…” overlay and plays the “Rhapsody in Blue final crescendo / elevator music” snippet while the remote conversation is starting.

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
- “Rhapsody in Blue final crescendo / elevator music” sting (while waiting for remote runtime to load).

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
  - Detects HIGH-risk confirmation events / conditions.
  - Orchestrates the scripted sequence and CTA.
  - Calls ElevenLabs TTS API (optional) and caches audio.
  - Posts commands to the webview to animate/play audio.
- **Webview UI (HTML/React or plain HTML)**:
  - Renders the red “eye” and animation states.
  - Plays audio via HTML5 Audio.
  - Sends `audioFinished` messages to the extension to advance the script.

### Data flow (TTS mode)
1) HIGH-risk confirmation triggers → `playSequence()`
2) Extension posts `{ type: 'visual', status: 'pulsating' }`
3) For each line:
   - Extension calls ElevenLabs `text-to-speech/{voiceId}` (audio/mpeg)
   - Converts to base64 data URI (or writes to temp/cache and passes a webview URI)
   - Webview plays audio and posts `{ type: 'audioFinished' }` on end
4) Extension shows a CTA to switch/teleport to remote runtime (does not auto-switch).
   - If the user ignores the CTA: stop the HAL overlay and leave the normal confirmation UI unchanged.
5) If the user triggers the CTA:
   - Start switching to remote runtime and starting a new remote conversation (per current mode-switch policy).
   - While waiting:
     - Overlay the “HAL” UI state (see Decisions below)
     - Play the “Rhapsody in Blue final crescendo / elevator music” snippet
     - Cycle overlay copy (e.g., “Teleporting…”, “Caffeinating server…”, “Deciphering remote protocol…”, “Calling reindeer…”, “Teleporting…”)
6) When the remote conversation is ready: stop the snippet (fade out if supported) and reset the UI back to normal rendering.

### Data flow (bundled-audio mode, deferred for later)
1) Trigger occurs → `playSequence()`
2) Extension posts `{ type: 'playClip', clipId: 'hal_sorry_engel' }`
3) Webview maps `clipId` → `media/*.mp3` and plays immediately
4) Same `audioFinished` handshake to keep timing deterministic

## Settings / configuration
Proposed settings (names TBD):
- `openhands.elevenlabs.enabled`: boolean (default `false`)
- `openhands.elevenlabs.mode`: `bundled` | `api` (default: `api`)
- API key:
  - Settings UI placeholder: `openhands.secrets.elevenLabsApiKey`
  - Stored securely in SecretStorage: `openhands.elevenLabsApiKey` (already implemented)
- `openhands.elevenlabs.voiceAId`, `openhands.elevenlabs.voiceBId`: string
- `openhands.elevenlabs.modelId`: e.g. `eleven_turbo_v2` (optional)
- `openhands.elevenlabs.volume`: 0.0–1.0
- `openhands.elevenlabs.cache`: boolean (default `true`)

## Caching strategy (API mode)
- Cache by `(voiceId, modelId, normalizedText)` → audio bytes
- Store in `context.globalStorageUri` or a small on-disk cache
- Cap size (LRU) to avoid disk bloat

## Error handling
- If an ElevenLabs API call fails: fall back to a text-only notification and auto-disable the HAL sequence for the **current conversation**.
  - Definition (“disable for the conversation”): an in-memory flag scoped to the current conversation id/run; it resets automatically when the user starts a new conversation (so the next conversation can try again if it hits a HIGH-risk confirmation).
  - Do not persist this auto-disable state to disk.
  - Do not spam: show at most one failure notification per conversation.
- Retry/backoff strategy (API mode):
  - No retries for invalid configuration (e.g., auth errors / missing key).
  - For transient failures (network errors, 5xx, 429): retry up to **2** times (3 attempts total) with exponential backoff (e.g., 250ms, 500ms) and jitter; if still failing, abort the sequence and auto-disable for the conversation.
- If webview isn’t ready: queue the trigger and show a standard VS Code notification.
- Never block the user’s ability to continue working.

## Teleport / remote runtime CTA
At the end of the sequence, provide a clear action:
- Button in the webview: “Transfer to remote runtime”
- Or a VS Code command: `openhands.switchToRemoteRuntime`
Behavior: switches mode/settings and starts a new conversation in remote mode; show the “Teleporting…” overlay (and play the snippet) until the remote conversation is ready.

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
- Add an E2E action to simulate a HIGH-risk confirmation.
- Verify `openhands._queryUiState` and `openhands._queryHalState` reflect the expected progression (e.g., `dialogue → prompt → waiting_remote → idle`).

#### `_queryHalState` (test/debug contract)
Purpose: enable deterministic E2E assertions about the HAL UX without DOM automation.

- Command id: `openhands._queryHalState` (test/debug-only; not user-facing).
- Behavior: returns a Promise of a JSON-serializable object; if the webview is not available/ready, return a default “idle” state.
- What it queries: the webview’s HAL presentation state (eye animation + overlay state + audio playback step).
- Return shape (minimal):
  - `enabled`: boolean (feature toggle on and not auto-disabled for this conversation)
  - `phase`: `idle | dialogue | prompt | waiting_remote | error`
  - `eye`: `off | dim | pulsating`
  - `stepIndex`: number (0-based dialogue line index) or `null` when not in dialogue
  - `lastError`: string | null (non-secret, user-safe)
- Implementation location:
  - Extension host: `src/extension.ts` registers `openhands._queryHalState` and round-trips a `queryHalState` request to the webview (mirrors `openhands._queryUiState`).
  - Webview: `src/webview-src/components/App.tsx` handles `queryHalState` and replies with `halStateResponse`.
- Example E2E usage:
  ```ts
  const hal: any = await vscode.commands.executeCommand('openhands._queryHalState');
  expect(hal.phase).to.equal('dialogue');
  ```

## Security & privacy
- Never send user prompts/content to ElevenLabs; only send fixed script strings.
- Store API key only in VS Code Secrets.
- Avoid logging audio payloads or API responses.

## Rollout plan
Phase 0:
- Add scaffolding: webview animation + API-mode playback behind a feature flag.
Phase 1:
- Add caching + polish: retries/backoff, “stop” UI, and tight error UX.
Phase 2:
- Add bundled-audio mode (optional), then expand scripts / voice packs (optional).

## Decisions (Q&A)

| Topic | Decision | Owner | Date |
| --- | --- | --- | --- |
| Eye placement | Overlay inside the chat webview view; horizontally centered; vertically just above the prompt area. | Engel | 2025-12-22 |
| Trigger conditions | Only trigger (if enabled) when the confirmation prompt risk is `HIGH`. | Engel | 2025-12-22 |
| Music sting | Play a snippet while waiting for remote runtime to load the conversation (during the “Teleporting…” overlay). | Engel | 2025-12-22 |
