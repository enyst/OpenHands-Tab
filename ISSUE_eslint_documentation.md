# Document ESLint Configuration Architecture

## Problem
ESLint config has several non-obvious decisions that aren't documented for future maintainers.

## What Needs Documentation

### 1. Why projectService isn't used
- Multiple tsconfig files covering different parts of codebase
- tsconfig.json excludes webview code
- tsconfig.webview.json only includes webview code
- projectService doesn't handle this split well

### 2. Why rules are warnings vs errors
- Type-checked rules are warnings for gradual adoption
- Plan to migrate to errors over time
- Don't want to block development on pre-existing issues

### 3. Test file configuration
- Why both Mocha AND Vitest globals
- E2E tests (tests/e2e/**) use Mocha
- Unit tests (src/**/__tests__/**) use Vitest
- Both need their respective globals

### 4. Type-aware linting setup
- How it works
- Why we need tsconfigRootDir
- What rules are type-checked

## Solution
Create `docs/LINTING.md` with:
- Architecture overview
- Configuration decisions and rationale
- How to add new rules
- Common issues and solutions
- Migration path for type-safety warnings
- How to run linting locally
- How to fix common errors

## Priority
Low - Helps maintainability long-term

## Related
PR #32 - ESLint Infrastructure
