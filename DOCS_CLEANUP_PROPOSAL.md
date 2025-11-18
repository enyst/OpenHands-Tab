# Documentation Cleanup - Completed

## Files Removed

### 1. `CONTRIBUTING.md` - **REMOVED** ✅
**Reason**: Merged into AGENTS.md
- Content was redundant with AGENTS.md
- Unique content (workspace commands, package notes) merged into AGENTS.md
- AGENTS.md is now the single source of truth for contribution guidelines

---

### 2. `README_DEV.md` - **REMOVED** ✅
**Reason**: Redundant with README.md and AGENTS.md
- Only 13 lines long
- Information already covered in:
  - README.md (Development section)
  - AGENTS.md (Build, Test, and Development Commands)
- No unique value

---

### 3. `packages/agent-sdk-ts/findings.md` - **REMOVED** ✅
**Reason**: Working notes/investigation log, not documentation
- Contained development investigation notes
- Had TODO items and gap analysis from development
- Already implemented fixes are documented
- Not useful for end users or new contributors

---

## Result

**Files Removed**:
- CONTRIBUTING.md (merged into AGENTS.md)
- README_DEV.md (redundant)
- packages/agent-sdk-ts/findings.md (internal notes)

**Files Updated**:
- AGENTS.md (now includes all contribution guidelines with workspace-aware commands)

## Files Updated (Already Fixed)

The following documentation has been updated to fix outdated information:

1. **docs/agent-sdk-architecture.md**
   - ✅ Fixed event discriminant from `type` to `kind` (matching PR #108)
   - ✅ Fixed file path from `src/types/index.ts` to `src/sdk/types/index.ts`
   - ✅ Removed outdated TODO about LocalConversation being a stub

2. **docs/PRD.md**
   - ✅ Fixed event discriminant references (`event.type` → `event.kind`)
   - ✅ Fixed file path for types
   - ✅ Removed reference to deleted `src/terminal/BashEventsClient.ts`
   - ✅ Clarified bash events are now local-only (not WebSocket)
   - ✅ Removed outdated bash-events WebSocket schema documentation

3. **docs/settings_prd.md**
   - ✅ Removed `/sockets/bash-events` WebSocket endpoint reference
   - ✅ Removed `bash_events_dir` from server config list
   - ✅ Clarified bash events implementation (local mode, no WebSocket)

## Key Changes Made

### Event Discriminant Update (type → kind)
The recent refactoring (PR #108) changed the event discriminant field from `type` to `kind`. All documentation now reflects this:
- `EventBase.kind` instead of `EventBase.type`
- Type guards use `e.kind === 'MessageEvent'` instead of `e.type === 'MessageEvent'`

### File Path Corrections
- SDK types moved to `packages/agent-sdk-ts/src/sdk/types/` (nested sdk/ folder)
- Documentation now uses correct paths

### Bash Events Clarification
- Bash events are now emitted by `LocalConversation` as 'terminal' events in local mode
- The old `/sockets/bash-events` WebSocket endpoint and `BashEventsClient.ts` were removed
- Documentation clarified to avoid confusion between old (WebSocket) and new (local events) implementations
