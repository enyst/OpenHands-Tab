# Documentation Audit Report - OpenHands-Tab

## Executive Summary

This audit compared the documentation in README.md and docs/ against the actual codebase implementation. Multiple discrepancies were found where features have been implemented but documentation has not been updated, or where documentation describes structures that don't match reality.

## Critical Findings

### 1. README.md - Missing Commands

**Issue**: The README lists only basic commands but package.json contains many more specialized commands.

**Current README lists**:
- OpenHands: Configure
- OpenHands: Set API Key
- OpenHands: Set Session API Key
- OpenHands: Set GitHub Token
- OpenHands: Set Custom Secret 1/2/3

**Actually implemented (package.json)**:
- ✓ All of the above, PLUS:
- OpenHands: Explain Selection (NEW - not documented)
- OpenHands: Set OpenAI API Key (NEW - provider-specific)
- OpenHands: Set Anthropic API Key (NEW - provider-specific)
- OpenHands: Set OpenRouter API Key (NEW - provider-specific)
- OpenHands: Set LiteLLM Proxy API Key (NEW - provider-specific)
- OpenHands: Set Gemini API Key (NEW - provider-specific)
- OpenHands: Set ElevenLabs API Key (NEW - provider-specific)
- OpenHands: Diagnostics (Internal) (NEW - internal tool)

**Recommendation**: Update README commands section to include provider-specific API key commands and the "Explain Selection" feature.

---

### 2. README.md - Missing Configuration Settings

**Issue**: Documentation mentions only basic settings but package.json defines extensive configuration options.

**Not documented in README**:
- `openhands.agent.debug` - Enable local-mode debug events
- `openhands.agent.summarizeToolCalls` - Generate Gemini summaries for tool calls
- `openhands.devBridge.enabled` - Enable webview debugging bridge
- **Entire HAL 9000 Easter Egg section** (10+ settings for a theatrical high-risk confirmation flow):
  - `openhands.hal.enabled` - Enable the HAL 9000 easter egg
  - `openhands.hal.mode` - Choose mode: `bundled` (E2E/CI), `tts_only` (demo with buttons), `voice_confirm` (interactive - you can talk to HAL!)
  - `openhands.hal.userName` - Your name in HAL's dialogue (default: "Engel" as in "I'm sorry, Engel...")
  - `openhands.hal.voiceAId`, `voiceUserId` - ElevenLabs voice IDs for HAL and user voices
  - `openhands.hal.modelId` - ElevenLabs model ID
  - `openhands.hal.volume`, `cache` - Audio settings
  - `openhands.hal.llmProfileId` - Gemini profile for voice confirmation classification

**What HAL actually does** (from docs/hal/elevenlabs_prd.md):
When a HIGH-risk action requires confirmation, instead of showing a normal dialog, HAL displays:
- A pulsating red eye overlay (like HAL 9000's camera)
- Scripted dialogue: "I'm sorry, {userName}, I can't let you do that..."
- Three options: Approve locally / Teleport to remote runtime / Reject
- In `voice_confirm` mode: you can actually SPEAK your decision to HAL via microphone!
- When teleporting: plays Rhapsody in Blue while setting up the remote connection
- Uses ElevenLabs TTS for HAL's voice and optionally Gemini for understanding your voice response

**Recommendation**: Add an "Easter Eggs" or "Advanced Features" section to README documenting HAL. This is too cool to hide!

---

### 3. SDK Architecture Documentation - Incorrect Directory Structure

**Issue**: docs/agent-sdk-architecture.md and packages/agent-sdk-ts/AGENTS.md claim incorrect directory structure.

**Documentation claims**:
```
packages/agent-sdk-ts/src/
├── conversation/
├── context/
├── runtime/
├── llm/
├── tools/
├── workspace/
└── types/
```

**Actual structure**:
```
packages/agent-sdk-ts/src/
├── sdk/
│   ├── conversation/
│   ├── context/
│   ├── runtime/
│   ├── llm/
│   └── types/
├── tools/
├── types/
└── workspace/
```

**Impact**: This affects import paths mentioned in documentation examples and architectural diagrams.

**Recommendation**: Update all directory references to reflect the actual `src/sdk/` nested structure.

---

### 4. SDK Tools - Missing FinishTool Documentation

**Issue**: The SDK implements a `FinishTool` that is not documented anywhere.

**Evidence**: `packages/agent-sdk-ts/src/tools/FinishTool.ts` exists with:
```typescript
readonly name = 'finish';
readonly description = 'Signal that the agent is finished and should stop the current run.';
```

**Documented tools in agent-sdk-architecture.md**:
- TerminalTool ✓
- FileEditorTool ✓
- TaskTrackerTool ✓
- BrowserTool ✓
- GlobTool ✓
- GrepTool ✓
- BrowserUseTool ✓
- PlanningFileEditorTool ✓
- DelegateTool ✓
- IntegratedTerminalRunner ✓
- **FinishTool** ❌ MISSING

**Recommendation**: Add FinishTool to the tools documentation section.

---

### 5. LLM Providers - Gemini Already Implemented

**Issue**: docs/agent-sdk-architecture.md section "Future Enhancements" lists Gemini as planned, but it's already implemented.

**Documentation says** (line 1662):
```markdown
### Planned Features

1. **Additional LLM Providers**
   - Google Gemini
   - Mistral
   - Cohere
```

**Reality**:
- File exists: `packages/agent-sdk-ts/src/sdk/llm/gemini.ts`
- Tests exist: `factory.gemini-profile-generation-config.test.ts`
- Package.json has Gemini API key settings

**Recommendation**: Move Gemini from "Future Enhancements" to the implemented LLM providers section.

---

### 6. Extension Structure Documentation - Missing Directories

**Issue**: docs/PRD.md shows extension structure but misses several implemented directories.

**Documentation shows** (lines 176-203):
```
src/
├── extension.ts
├── conversation/host/
├── settings/
├── sidebar/
├── webview/host/
└── webview-src/
```

**Actually exists**:
```
src/
├── extension.ts
├── conversation/
├── extension/        ← NEW, not documented
├── dev/              ← NEW, not documented
├── hal/              ← NEW, not documented (HAL feature)
├── settings/
├── shared/
├── sidebar/
├── terminal/         ← NEW, not documented
├── webview/
└── webview-src/
```

**Recommendation**: Update directory structure diagrams to include all directories, especially `hal/` for the HAL feature.

---

### 7. Settings PRD - Gemini Configuration Outdated

**Issue**: docs/settings_prd.md mentions Gemini settings only for HAL, but Gemini is now a full LLM provider.

**Line 54 says**:
> **Using Gemini as the main agent LLM**: set `openhands.llm.profileId` to a Gemini profile id (for example `gemini-flash`) and store your API key via **OpenHands: Set API Key**. (The `openhands.hal.gemini.*` settings are only used for HAL voice-confirm decision classification, not the agent's main LLM.)

**Reality**:
- There's a dedicated "OpenHands: Set Gemini API Key" command
- Gemini is a fully supported provider with its own client implementation
- HAL uses a separate Gemini profile (`openhands.hal.llmProfileId`)

**Recommendation**: Clarify that Gemini can be used both as the main agent LLM and separately for HAL.

---

### 8. vscode_local_setup.md - Incomplete Debug Bridge Documentation

**Issue**: The debug bridge section mentions it exists but doesn't fully explain when it's enabled.

**Current documentation** (lines 4-22):
> The webview → extension logging bridge ... is enabled automatically when the extension runs in Development or Test mode, and can also be enabled manually in normal installs.

**Missing**: Clear reference to the `openhands.devBridge.enabled` setting from package.json.

**Recommendation**: Add explicit reference to the setting:
```markdown
- Manual: set `openhands.devBridge.enabled` to `true` in VS Code Settings
```

---

### 9. Node.js Version Requirements - Inconsistency

**Issue**: Different documents mention different Node.js version requirements.

- **README.md line 21**: "Node.js 22+"
- **AGENTS.md line 7**: "Node.js 22 LTS (npm >= 10)"
- **package.json engines**: `"node": ">=22.12.0 <23"`

**The strictest requirement** (package.json) is actually `>=22.12.0 <23`, not just "22+".

**Recommendation**: Update README and AGENTS to match package.json: "Node.js >= 22.12.0 (< 23)".

---

### 10. README.md Tools List - Incomplete

**Issue**: README line 77 lists SDK tools but is incomplete and outdated.

**README says**:
> - Tools (Terminal, FileEditor, TaskTracker, Browser, Glob, Grep, BrowserUse, PlanningFileEditor, Delegate)

**Should include**:
- FinishTool (missing)
- IntegratedTerminalRunner (missing from README, though mentioned in architecture docs)

**Recommendation**: Update to:
> - Tools (Terminal, FileEditor, TaskTracker, Browser, Glob, Grep, BrowserUse, PlanningFileEditor, Delegate, Finish, IntegratedTerminalRunner)

---

## Summary of Recommendations

### High Priority (User-Facing Features)
1. ✅ Document "Explain Selection" command (new user feature)
2. ✅ Document HAL (High-risk Action Listener) feature and all its settings
3. ✅ Document provider-specific API key commands
4. ✅ Add FinishTool to tools documentation
5. ✅ Update LLM providers list (move Gemini from "planned" to "implemented")

### Medium Priority (Developer Documentation)
6. ✅ Fix SDK directory structure in architecture docs
7. ✅ Update extension structure diagram
8. ✅ Clarify Node.js version requirements consistently

### Low Priority (Minor Corrections)
9. ✅ Add debug settings documentation
10. ✅ Update tools list in README

## Proposed Changes

The following files need updates:
1. **README.md** - Add commands, settings, clarify tools list
2. **docs/agent-sdk-architecture.md** - Fix directory structure, move Gemini to implemented
3. **packages/agent-sdk-ts/AGENTS.md** - Fix directory structure
4. **docs/PRD.md** - Update extension directory structure
5. **docs/settings_prd.md** - Clarify Gemini usage
6. **docs/vscode_local_setup.md** - Add devBridge setting reference
7. **AGENTS.md** - Update Node version requirement

Would you like me to implement these updates?
