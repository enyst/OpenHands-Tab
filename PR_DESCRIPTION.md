# docs: update markdown files to match current implementation

## Summary

This PR updates the documentation (.md files) to accurately reflect the current implementation state:

### Changes Made

- **README.md**: Updated VS Code version requirement from 1.85.0 to 1.104.0
- **README_DEV.md**: Clarified Tailwind CSS 4.x build process and webview stack details
- **PRD.md**:
  - Updated engine requirement to 1.104.0
  - Fixed extension structure (removed reference to non-existent `OpenHandsPanel.ts`)
  - Marked unimplemented features with TODO:
    - Confirmation mode (backend ready, UI not implemented)
    - LLM switching (currently hardcoded to claude-sonnet-4)
    - Resume command (endpoint exists but not exposed in command palette)
  - Updated Configure command description (input box, not quick-pick/form)
- **IMPLEMENTATION_PLAN.md**:
  - Updated Phase 5 and 6 status from "IN PROGRESS" to "COMPLETED"
  - Added details about React 19, @openhands/ui components, Tailwind CSS 4.x
  - Documented completed features (event visualization, toasts, type-safe event handling)

### Key Documentation Fixes

1. **Accurate version requirements** - Now matches package.json
2. **Correct file structure** - Reflects actual implementation (webview in extension.ts, not separate panel file)
3. **TODO markers** - Clear visibility of what's planned but not yet implemented
4. **Build process clarity** - Explains Tailwind CSS compilation and webview bundling

### Files Changed

- README.md
- README_DEV.md
- PRD.md
- IMPLEMENTATION_PLAN.md

### Test Plan

- [x] All documentation changes reviewed
- [x] Cross-referenced with actual implementation files
- [x] TODO markers added for unimplemented features
- [x] Build process steps verified

### What's marked as TODO

These features are documented but not yet implemented:

1. **Confirmation Mode UI** - Backend supports action confirmation, but webview UI for approve/reject flow is not implemented
2. **LLM Model Selection** - Currently hardcoded to `claude-sonnet-4` in ConnectionManager; no UI to switch models
3. **Resume Command** - The `/api/conversations/{id}/resume` endpoint exists but the command is not exposed in VS Code command palette

🤖 Generated with [Claude Code](https://claude.com/claude-code)
