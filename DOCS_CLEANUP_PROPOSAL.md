# Documentation Cleanup Proposal

## Files Proposed for Removal

### 1. `README_DEV.md` - **REMOVE**
**Reason**: Redundant with README.md and CONTRIBUTING.md
- Only 13 lines long
- Information already covered in:
  - README.md (Development section)
  - CONTRIBUTING.md (Build, Test, and Development Commands)
- No unique value

**Impact**: None - all info is duplicated elsewhere

---

### 2. `AGENTS.md` - **CONSIDER RENAMING OR MERGING**
**Reason**: Overlaps significantly with CONTRIBUTING.md
- CONTRIBUTING.md is newer and more comprehensive
- Both cover: project structure, build commands, coding style, testing, commits
- AGENTS.md has some unique content about package-specific notes

**Options**:
1. **REMOVE** AGENTS.md, migrate unique content to CONTRIBUTING.md
2. **RENAME** AGENTS.md to something more specific if it has a distinct purpose
3. **KEEP BOTH** but clearly differentiate their purposes

**Recommendation**: Remove AGENTS.md and ensure CONTRIBUTING.md has all the content

---

### 3. `packages/agent-sdk-ts/findings.md` - **REMOVE**
**Reason**: Working notes/investigation log, not documentation
- Contains development investigation notes
- Has TODO items and gap analysis from development
- Already implemented fixes are documented
- Not useful for end users or new contributors

**Impact**: None - this is internal working notes

---

## Summary

**Definite Removals** (no risk):
- README_DEV.md
- packages/agent-sdk-ts/findings.md

**Consider**:
- AGENTS.md (overlaps with CONTRIBUTING.md)

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
