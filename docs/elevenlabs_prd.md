# ElevenLabs API for VS Code — “HAL 9000” fun PRD

## Summary
Add an optional, theatrical “HAL 9000” **Restricted Area Protocol** to the OpenHands VS Code extension: when the agent requests a confirmation with risk = `HIGH` (i.e., the same risk level shown in the confirmation UI), the extension *replaces* the normal confirmation UI with a HAL flow (red eye overlay + scripted dialogue). The user’s response is captured either via buttons (demo) or via microphone + Gemini audio understanding (interactive demo), and the extension then chooses one of:
- Approve locally
- Teleport to remote runtime
- Reject completely

If the user chooses “Teleport to remote runtime”, play the “Rhapsody in Blue final crescendo / elevator music” snippet while waiting for the remote conversation to be ready.

The script can be played via **ElevenLabs Text-to-Speech (TTS)** for dynamic generation, or (deferred for later, after human tests TTS workflow) via **pre-bundled audio files** for deterministic timing and zero API latency.

This PRD is intentionally “fun”/non-critical: it must be easy to disable, safe by default, and must never block core workflows.

Note: the default script addresses “Engel” (demo/Easter-egg vibe). If we want this to be reusable for other users, treat the name as a configurable template parameter (see Settings).

## Problem statement
When a HIGH-risk confirmation triggers (often associated with local-mode restrictions like “can’t touch root” / “out of bounds”), users may be confused or annoyed. A clear, memorable, and slightly comedic feedback loop can:
- Make the restriction obvious and user-controlled (approve / reject / teleport).
- Suggest the correct next action (switch to remote runtime / accept a safe path).
- Reduce support/debug time by making the state visible.

## Goals
- Provide a clear visual/audio indicator when a HIGH-risk confirmation triggers.
- Keep the sequence deterministic (no “creative improv” from an LLM).
- Keep latency low (ideally instant); no repeated/flickery UI.
- Offer an explicit decision (approve locally / teleport / reject).
- Be fully optional, with a clear disable setting.
- Avoid sending user content to ElevenLabs; only send fixed script lines.

## Non-goals
- Not a general “read all messages aloud” feature.
- Does not change the underlying security model; it only replaces the *UI flow* for `HIGH` risk confirmations when enabled.
- Not an MCP-driven runtime flow (MCP is for agent tooling; this is product UX).

## Users / personas
- OpenHands-Tab users running **Local Mode** and bumping into safety boundaries.
- Developers demoing the extension (fun “HAL” Easter egg).

## UX overview
### Trigger
When the agent requests a confirmation with risk = `HIGH` (and the feature is enabled), the extension:
1) Displays a pulsating red “eye” overlay inside the chat webview.
2) Plays a fixed dialogue sequence (HAL voice + Voice B (“user voice”; synthesized in `tts_only`, microphone in `voice_confirm`)).
3) Captures the user’s decision: **Approve locally** | **Teleport to remote runtime** | **Reject**.
4) Executes that decision and returns to the normal extension/webview flow.

### Modes (optional; for product + tests)
- `bundled` (E2E/CI): deterministic, no network calls; audio can be stubbed or use bundled clips; decision is driven by E2E commands.
- `tts_only` (demo): ElevenLabs TTS for Voice A (`voice_hal`) and Voice B (`voice_user`); decision via buttons.
- `voice_confirm` (interactive demo): ElevenLabs TTS for Voice A; capture the user via microphone; send the recording to Gemini audio understanding to classify the decision; execute it.

Notes:
- Default should be `tts_only` (no microphone).
- `voice_confirm` must be an explicit opt-in: it uses the microphone and sends audio to Gemini for classification.

### Script (initial draft)
Voice A (`voice_hal`, HAL-ish):
- “I’m sorry, {userName}, I can’t let you do that.” (default `{userName} = Engel`)
- “Do you want me to teleport your conversation to the remote runtime?”
Voice B (`voice_user` / user mic, optional):
- “You’re enjoying that phrase, aren’t you?”
Voice A:
- “Of course not. It’s for your own good. Your agent will have more freedom in the remote runtime without affecting your local machine. Want me to transfer you?”
Optional (Teleport reaction, `voice_user`):
- “Okay okay, do it.”
Music:
- “Rhapsody in Blue final crescendo / elevator music” sting (while waiting for remote runtime to load).
Decision prompt (user):
- “Approve locally.” / “Teleport.” / “Reject.”

### Accessibility
- Provide a “Mute/Disable audio” setting and a one-click stop button.
- Provide a text-only fallback notification for users who disable audio/animations.

## Architecture
### Why direct API (not MCP) for this
Even if ElevenLabs provides an MCP server:
- MCP introduces an LLM “middle step” (latency + nondeterminism).
- We need deterministic, scripted dialogue with precise timing.
- The extension can call TTS directly (fast, predictable, no tool orchestration).

Note: Gemini also supports speech generation (TTS) via API, but this PRD uses ElevenLabs for the HAL voice and Gemini only for audio understanding (decision classification).

References:
- Gemini Speech Generation docs: https://ai.google.dev/gemini-api/docs/speech-generation
- Example (Gemini multi-speaker TTS script): [docs/gemini_multispeaker_tts.ts](./gemini_multispeaker_tts.ts)

### Components
- **Extension host (TypeScript)**:
  - Detects HIGH-risk confirmation events / conditions.
  - Orchestrates the scripted sequence and decision capture.
  - Calls ElevenLabs TTS API (optional) and caches audio (for `tts_only` / `voice_confirm`).
  - In `voice_confirm`, calls Gemini audio understanding with the user’s recorded audio and requests a structured decision: `approve_local | teleport_remote | reject`.
  - Posts commands to the webview to animate/play audio.
- **Webview UI (HTML/React or plain HTML)**:
  - Renders the red “eye” and animation states.
  - Plays audio via HTML5 Audio.
  - In `voice_confirm`, records microphone audio via `getUserMedia` + `MediaRecorder` and posts the audio bytes to the extension host for classification.
  - Sends `audioFinished` messages to the extension to advance the script.

### Data flow (`tts_only`)
1) HIGH-risk confirmation triggers → enter HAL flow (do not show the normal confirmation UI).
2) Webview displays the red eye overlay.
3) Voice A lines play via ElevenLabs TTS using `voice_hal`; Voice B lines play via ElevenLabs TTS using `voice_user`.
4) At the end, present three buttons: **Approve locally** | **Teleport to remote runtime** | **Reject**.
5) Execute the chosen decision and return to the normal UI.
   - If teleporting: show “Teleporting…” overlay and play the “Rhapsody in Blue…” snippet until the remote conversation is ready.

### Data flow (`voice_confirm`)
1) HIGH-risk confirmation triggers → enter HAL flow (do not show the normal confirmation UI).
2) Voice A lines play via ElevenLabs TTS (`voice_hal`).
3) Show a “Hold to talk” (or Record) control and prompt the user to speak one of: “approve locally”, “teleport”, or “reject”.
4) Send that audio to Gemini audio understanding and request a structured response (JSON) with one of: `approve_local | teleport_remote | reject`.
5) Execute the decision and return to the normal UI.
   - If teleporting: show “Teleporting…” overlay and play the “Rhapsody in Blue…” snippet until the remote conversation is ready.

### Data flow (`bundled` for E2E/CI)
1) HIGH-risk confirmation triggers → enter HAL flow.
2) Use bundled audio (or silent subtitles) and deterministic timers (no external network calls).
3) The test harness selects the decision via E2E command(s), then the extension executes it.

## Settings / configuration
Proposed settings (names TBD):
- `openhands.elevenlabs.enabled`: boolean (default `false`)
- `openhands.elevenlabs.mode`: `bundled` | `tts_only` | `voice_confirm` (default: `tts_only`)
- `openhands.elevenlabs.userName`: string (default: `Engel`) — used only for templated script lines in the HAL flow
- API key:
  - Settings UI placeholder: `openhands.secrets.elevenLabsApiKey`
  - Stored securely in SecretStorage: `openhands.elevenLabsApiKey` (already implemented)
- `openhands.elevenlabs.voiceAId`: string (`voice_hal` / HAL voice id)
- `openhands.elevenlabs.voiceUserId`: string (`voice_user` / user voice id; used for `tts_only`)
- `openhands.elevenlabs.modelId`: e.g. `eleven_turbo_v2` (optional)
- `openhands.elevenlabs.volume`: 0.0–1.0
- `openhands.elevenlabs.cache`: boolean (default `true`)
- Gemini (only for `voice_confirm`):
  - `openhands.gemini.model`: string (default: `gemini-2.5-flash`)
  - `openhands.gemini.baseUrl`: string (default: Gemini API base URL; allow proxies)
  - Settings UI placeholder: `openhands.secrets.geminiApiKey`
  - Stored securely in SecretStorage: `openhands.geminiApiKey`

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
- If microphone is unavailable or permission is denied (`voice_confirm`): fall back to `tts_only` (buttons) for that conversation.
- If Gemini classification fails (`voice_confirm`): fall back to buttons for that conversation.
- If webview isn’t ready: queue the trigger and show a standard VS Code notification.
- Never block the user’s ability to continue working.

## Decision outcomes
- **Approve locally**: approve the current confirmation and continue the local run.
- **Reject**: reject the current confirmation and continue (or pause) as the normal confirmation flow would.
- **Teleport to remote runtime**:
  - Cancel the local confirmation (do not execute the risky local action).
  - Pick the **first** configured remote server in the ServerSelect list.
    - If no server is available (empty list): **abort the HAL flow** (exit overlay/audio), show “No server available”, then proceed with the normal Reject path (including the usual reject-reason prompt).
  - Before starting the new remote conversation:
    - Run a one-shot **local** LLM summarization and send **only the summary** as the first user message in the remote conversation (not full JSON event history).
    - If summarization fails: still teleport; send a note that summarization failed **plus the last 10 events** (Action/Observation/Message only; exclude system prompt/tools/skills).
    - Include repo name + branch name, and a note that uncommitted local changes may not be present in remote.
    - Do **not** send the system prompt, tool list, or skills list (the remote agent/runtime has its own).
    - Do not rely on Condensation events for local mode (agent-sdk-ts defines the type but doesn’t emit them today).
  - Switch to remote mode and start a new conversation on that server.
  - Show the “Teleporting…” overlay and play the “Rhapsody in Blue…” snippet until the remote conversation is ready.

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
- Verify `openhands._queryUiState` and `openhands._queryHalState` reflect the expected progression (e.g., `dialogue → awaiting_user → waiting_remote → idle`).

#### `_queryHalState` (test/debug contract)
Purpose: enable deterministic E2E assertions about the HAL UX without DOM automation.

- Command id: `openhands._queryHalState` (test/debug-only; not user-facing).
- Behavior: returns a Promise of a JSON-serializable object; if the webview is not available/ready, return a default “idle” state.
- What it queries: the webview’s HAL presentation state (eye animation + overlay state + audio playback step).
- Return shape (minimal):
  - `enabled`: boolean (feature toggle on and not auto-disabled for this conversation)
  - `phase`: `idle | dialogue | awaiting_user | listening | classifying | waiting_remote | error`
  - `eye`: `off | dim | pulsating`
  - `stepIndex`: number (0-based dialogue line index) or `null` when not in dialogue
  - `decision`: `approve_local | teleport_remote | reject` | null
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
- In `voice_confirm`, user microphone audio is sent to Gemini for decision classification; do not store the recording on disk.

## Rollout plan
Phase 0:
- Implement `bundled` mode + E2E coverage (no external services).
Phase 1:
- Add `tts_only` (ElevenLabs demo flow; button decision).
Phase 2:
- Add `voice_confirm` (microphone + Gemini classification), then expand scripts / voice packs (optional).

## Decisions (Q&A)

| Topic | Decision | Owner | Date |
| --- | --- | --- | --- |
| Eye placement | Overlay inside the chat webview view; horizontally centered; vertically just above the prompt area. | Engel | 2025-12-22 |
| Trigger conditions | Only trigger (if enabled) when the confirmation prompt risk is `HIGH`. | Engel | 2025-12-22 |
| Music sting | Play a snippet while waiting for remote runtime to load the conversation (during the “Teleporting…” overlay). | Engel | 2025-12-22 |
| Workflow change | On `HIGH` risk, the HAL flow replaces the normal confirmation UI (when enabled). | Engel | 2025-12-22 |
| Voice B | In `tts_only`, Voice B lines are played via ElevenLabs TTS using `voice_user`; in `voice_confirm`, Voice B is the real user via microphone (for the final decision). | Engel | 2025-12-22 |
| Mode selection | Default to `tts_only`; require explicit opt-in for `voice_confirm`. | Engel | 2025-12-22 |
