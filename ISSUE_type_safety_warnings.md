# Fix 178 Type-Safety Warnings

## Problem
Type-aware ESLint is now active and found 178 type-safety issues (currently warnings):

**Breakdown:**
- 39: Unexpected `any` type usage
- 28: Unsafe assignments of `any` values
- 40+: Unsafe member access on `any` (.type, .tool_name, .text, etc.)
- 4: Promise-returning functions where void expected
- 2: Invalid Uri in template expressions

## Impact
These represent potential runtime errors that TypeScript's type system should catch.

## Approach

### Phase 1: Quick Fixes (1-2 hours)
- Fix 2 template expression issues - add `.toString()`
- Fix 4 promise misuse issues - proper async handling

### Phase 2: Type Definitions (3-4 hours)
- Create type guards for agent-sdk events
- Type VS Code API usage
- Type message passing protocol

### Phase 3: Gradual Cleanup (ongoing)
- Replace `any` with proper types (39 instances)
- Add runtime validation where needed

## Files
- src/connection/ConnectionManager.ts (most issues)
- src/extension.ts (promise handling)
- src/webview-src/components/App.tsx (event types)

## Priority
Medium effort, High impact

## Related
PR #32 enabled type-aware linting
