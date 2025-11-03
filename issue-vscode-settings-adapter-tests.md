# Add test coverage for VscodeSettingsAdapter

**Priority**: P0 - Critical
**Labels**: testing, coverage, enhancement, vscode-integration
**Effort**: Medium (1-2 days)

## Problem

`src/settings/VscodeSettingsAdapter.ts` (37 lines) currently has **0% test coverage**. This adapter is the bridge between our extension and VS Code's configuration and secrets APIs, making it a critical integration point.

The VscodeSettingsAdapter handles:
- Reading configuration values from workspace/global settings
- Writing configuration updates
- Retrieving secrets from VS Code's secret storage
- Storing secrets securely
- Managing explicit vs. default values

Without tests, we have no automated verification that:
- Configuration reads work correctly with defaults
- Configuration updates target the correct scope (workspace vs global)
- Secrets are stored and retrieved properly
- Edge cases (undefined values, missing keys) are handled

## Current Coverage Gap

**Related files with NO tests:**
- `src/settings/VscodeSettingsAdapter.ts` - 0% coverage

**Files with good coverage (for reference):**
- `src/settings/SettingsManager.ts` - Well tested
- `src/settings/SettingsAdapter.ts` - Interface only

## Proposed Solution

Create `src/settings/__tests__/VscodeSettingsAdapter.test.ts` with comprehensive unit tests using mocked VS Code APIs.

## Tasks

### get() Method (3 tests)
- [ ] Test retrieves configuration value from workspace
- [ ] Test returns default when value not set
- [ ] Test supports nested keys (e.g., "llm.model")

### getExplicit() Method (2 tests)
- [ ] Test returns undefined when value not explicitly set
- [ ] Test returns value when explicitly configured

### update() Method (3 tests)
- [ ] Test updates workspace configuration by default
- [ ] Test updates global configuration when target is ConfigurationTarget.Global
- [ ] Test handles undefined (delete) values correctly

### getSecret() Method (2 tests)
- [ ] Test retrieves secret from secret storage
- [ ] Test returns undefined when secret not set

### storeSecret() Method (2 tests)
- [ ] Test stores secret in secret storage
- [ ] Test deletes secret when value is undefined

## Acceptance Criteria

- [ ] All 12 test cases pass
- [ ] Coverage for VscodeSettingsAdapter.ts increases from 0% to 100%
- [ ] Tests use proper VS Code API mocks
- [ ] Tests verify correct API parameters are passed
- [ ] CI pipeline runs tests successfully

## Testing Strategy

Mock VS Code's configuration and secrets APIs:

```typescript
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
    })),
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
}));

describe('VscodeSettingsAdapter', () => {
  let adapter: VscodeSettingsAdapter;
  let mockConfig: any;
  let mockSecrets: any;

  beforeEach(() => {
    mockConfig = {
      get: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
    };

    mockSecrets = {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
    };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

    adapter = new VscodeSettingsAdapter('openhandsTab', mockSecrets);
  });

  // ... tests
});
```

## Impact

- **High priority**: Critical integration point with VS Code APIs
- Ensures configuration and secrets management works correctly
- Prevents regressions when updating VS Code API usage
- Completes test coverage for the settings module

## Related Issues

- Related to overall test coverage improvement initiative
- Blocks confident refactoring of settings system

## Related Files

- `src/settings/VscodeSettingsAdapter.ts` (37 lines) - Target file
- `src/settings/SettingsAdapter.ts` - Interface definition
- `src/settings/SettingsManager.ts` - Uses adapter pattern
- `src/settings/__tests__/SettingsManager.test.ts` - Reference for testing patterns
