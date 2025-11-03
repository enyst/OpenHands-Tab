# ESLint Configuration Guide

This document explains the ESLint configuration choices for the OpenHands-Tab VS Code extension and provides guidance for maintaining and extending the linting setup.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [TypeScript Configuration Strategy](#typescript-configuration-strategy)
- [Type-Aware Linting](#type-aware-linting)
- [Test Framework Configuration](#test-framework-configuration)
- [Rule Severity Philosophy](#rule-severity-philosophy)
- [Adding New Linting Rules](#adding-new-linting-rules)
- [Running Linting Locally](#running-linting-locally)
- [Troubleshooting](#troubleshooting)
- [Migration Strategy](#migration-strategy)

## Architecture Overview

The project uses ESLint 9 with the flat config format (`eslint.config.js`) and TypeScript ESLint for type-aware linting. The configuration is split into three main sections:

1. **Production code** (`src/**/*.ts`, `src/**/*.tsx`) - Full type-aware linting with strict rules
2. **React/Webview code** (`src/webview-src/**/*.tsx`) - Additional React Hooks linting
3. **Test files** (`**/__tests__/**`, `**/*.test.ts`, `tests/**/*.ts`) - Relaxed rules, non-type-aware

### Key Files

- `eslint.config.js` - Main ESLint configuration
- `tsconfig.json` - TypeScript config for main extension code
- `tsconfig.webview.json` - TypeScript config for webview/React code
- `tsconfig.e2e.json` - TypeScript config for E2E tests
- `package.json` - Scripts for running linting

## TypeScript Configuration Strategy

### Why We Use Multiple TypeScript Configs

The project maintains three separate TypeScript configuration files, each serving a distinct purpose:

#### 1. `tsconfig.json` - Main Extension Code
```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview-src/**/*", "src/**/__tests__/**/*"]
}
```
- **Purpose**: Compiles Node.js-based VS Code extension code
- **Module system**: CommonJS (`"module": "commonjs"`)
- **Output**: `dist/` directory
- **Excludes**: Webview code and test files

#### 2. `tsconfig.webview.json` - React Webview Code
```json
{
  "include": ["src/webview-src/**/*"],
  "compilerOptions": {
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx"
  }
}
```
- **Purpose**: Compiles browser-based React webview code
- **Module system**: ES2022 with bundler resolution
- **JSX**: React 17+ automatic JSX runtime
- **Output**: `media/` directory (bundled by esbuild)

#### 3. `tsconfig.e2e.json` - End-to-End Tests
```json
{
  "include": ["tests/e2e/**/*.ts"],
  "compilerOptions": {
    "types": ["node", "mocha"]
  }
}
```
- **Purpose**: Compiles Mocha-based E2E tests using @vscode/test-electron
- **Types**: Mocha test framework types
- **Output**: `tests/e2e/out/` directory

### Why We Don't Use `projectService`

TypeScript ESLint's `projectService` option (which auto-discovers tsconfig files) is **incompatible** with our multi-tsconfig setup because:

1. **Conflicting module systems**: The extension uses CommonJS while the webview uses ES modules
2. **Separate compilation targets**: Different `include`/`exclude` patterns that don't overlap
3. **Build isolation**: Each tsconfig produces output to different directories

Instead, we explicitly specify both production tsconfig files in the ESLint parser options:

```javascript
parserOptions: {
  project: ['./tsconfig.json', './tsconfig.webview.json'],
  tsconfigRootDir: __dirname,
}
```

This ensures ESLint correctly type-checks both the extension and webview code while respecting their distinct compilation boundaries.

## Type-Aware Linting

### What is Type-Aware Linting?

Type-aware linting uses TypeScript's type checker to provide more sophisticated analysis than traditional AST-based linting. It can detect issues like:

- Unsafe assignments (`any` type propagation)
- Floating promises (unawaited async calls)
- Invalid type conversions
- Incorrect usage of Promise-returning functions

### Configuration Requirements

Type-aware linting requires three key parser options:

```javascript
parserOptions: {
  project: ['./tsconfig.json', './tsconfig.webview.json'],  // tsconfig paths
  tsconfigRootDir: __dirname,                                 // absolute base path
}
```

- **`project`**: Array of tsconfig paths relative to `tsconfigRootDir`
- **`tsconfigRootDir`**: Resolves relative paths and ensures consistent behavior across environments
- **Performance impact**: Type-aware rules are slower (~2-5x) than AST-only rules due to type-checking overhead

### Which Rules Are Type-Aware?

Rules from `@typescript-eslint/eslint-plugin` that require type information include:

- `@typescript-eslint/no-unsafe-*` - Detects unsafe `any` type usage
- `@typescript-eslint/no-floating-promises` - Catches unawaited promises
- `@typescript-eslint/no-misused-promises` - Validates Promise usage in conditionals
- `@typescript-eslint/require-await` - Ensures async functions use await
- `@typescript-eslint/await-thenable` - Validates await usage
- `@typescript-eslint/restrict-template-expressions` - Type-safe template strings

See the [TypeScript ESLint documentation](https://typescript-eslint.io/linting/typed-linting/) for the complete list.

### Why Test Files Aren't Type-Checked

Test files use a separate ESLint configuration block (lines 116-147 in `eslint.config.js`) that **does not** include `parserOptions.project`. This is intentional because:

1. Test files are excluded from production tsconfig files
2. Type-aware linting would require a separate tsconfig for tests, increasing complexity
3. Tests benefit from relaxed type rules (using `any` for mocks, etc.)
4. Faster linting: Non-type-aware linting is 2-5x faster

## Test Framework Configuration

### Dual Framework Strategy

The project uses two test frameworks for different purposes:

#### Vitest - Unit Tests
- **Location**: `src/**/__tests__/**/*`, `src/**/*.test.ts`, `src/**/*.test.tsx`
- **Purpose**: Fast unit tests for business logic and React components
- **Environment**: jsdom (browser simulation)
- **Globals**: `vitest`, `describe`, `it`, `expect`, etc.
- **Run command**: `npm test` or `npm run test:watch`

**Configuration**: `vitest.config.ts`
```javascript
test: {
  environment: 'jsdom',
  exclude: ['tests/e2e/**']  // Exclude E2E tests
}
```

#### Mocha - E2E Tests
- **Location**: `tests/e2e/**/*.test.ts`
- **Purpose**: Integration tests using @vscode/test-electron
- **Environment**: Real VS Code instance
- **Globals**: `mocha`, `describe`, `it`, `before`, `after`, etc.
- **Run command**: `npm run e2e`

**Configuration**: Uses Mocha runner with VS Code test environment

### ESLint Global Configuration

The test file ESLint block includes globals for both frameworks:

```javascript
globals: {
  ...globals.node,
  ...globals.browser,
  ...globals.mocha,        // E2E test globals
  ...(globals.vitest || {}), // Unit test globals (with fallback)
}
```

This allows ESLint to recognize test framework functions like `describe`, `it`, `expect`, etc., preventing false positives for undefined variables.

## Rule Severity Philosophy

### Error vs. Warning Strategy

The configuration uses a **gradual adoption** approach for type-safety rules:

- **Errors** 🔴: Block builds/commits, must be fixed immediately
- **Warnings** 🟡: Reported but don't block, should be fixed over time

### Current Warning Rules (Gradual Adoption)

These type-checked rules are set to `'warn'` to allow incremental fixes:

```javascript
'@typescript-eslint/no-unsafe-member-access': 'warn',   // Accessing any properties
'@typescript-eslint/no-unsafe-assignment': 'warn',      // Assigning any values
'@typescript-eslint/no-unsafe-call': 'warn',            // Calling any functions
'@typescript-eslint/no-unsafe-argument': 'warn',        // Passing any arguments
'@typescript-eslint/no-unsafe-return': 'warn',          // Returning any values
'@typescript-eslint/require-await': 'warn',             // Async without await
'@typescript-eslint/no-floating-promises': 'warn',      // Unawaited promises
'@typescript-eslint/no-misused-promises': 'warn',       // Promise usage errors
'@typescript-eslint/restrict-template-expressions': 'warn', // Non-string templates
```

### Rationale

1. **No Build Breakage**: Warnings don't block development while introducing strict type-checking
2. **Incremental Migration**: Allows fixing issues file-by-file or feature-by-feature
3. **Visibility**: Warnings still appear in IDE and CI, encouraging fixes
4. **Future Plan**: Upgrade warnings to errors once the codebase reaches acceptable compliance

### React Hooks Exception

The `react-hooks/exhaustive-deps` rule is set to `'error'` (upgraded from default `'warn'`) because:
- React Hook dependency bugs are difficult to debug
- Missing dependencies cause subtle runtime bugs and stale closures
- The rule has high accuracy and low false-positive rate
- Fixes are usually straightforward

## Adding New Linting Rules

### Step 1: Identify the Appropriate Configuration Block

Choose the correct configuration block based on where the rule should apply:

1. **Production code block** (lines 26-91): Rules for `src/**/*.ts(x)` excluding tests
2. **React/webview block** (lines 92-114): Additional rules for `src/webview-src/**/*.tsx`
3. **Test files block** (lines 116-147): Rules for `**/__tests__/**/*.ts(x)`, `**/*.test.ts(x)`, and `tests/**/*.ts`

### Step 2: Determine Rule Severity

Follow these guidelines:

- **Use `'error'`** if:
  - The issue causes runtime bugs or security vulnerabilities
  - The fix is always clear and unambiguous
  - False positives are rare
  - Example: `'no-throw-literal'`, `'prefer-const'`

- **Use `'warn'`** if:
  - The rule is new and may have many existing violations
  - The rule is being gradually adopted
  - The fix requires architectural changes
  - Example: Type-safety rules during migration

- **Use `'off'`** if:
  - The rule conflicts with project conventions
  - The rule has too many false positives
  - TypeScript already catches the issue
  - Example: `'no-undef'` (TypeScript handles this)

### Step 3: Add the Rule

```javascript
rules: {
  // ... existing rules ...
  'new-rule-name': ['error', { option: 'value' }],
}
```

### Step 4: Test the Rule

```bash
# Run linting on the entire codebase
npm run lint

# Run linting with auto-fix where possible
npm run lint:fix

# Check specific files
npx eslint src/path/to/file.ts
```

### Step 5: Address Existing Violations

Choose one approach:

1. **Fix all violations immediately** (preferred for new rules with few violations)
2. **Set to `'warn'` temporarily** and fix incrementally
3. **Add targeted `eslint-disable` comments** with justification (last resort)

## Running Linting Locally

### Available Commands

```bash
# Run ESLint on the entire project
npm run lint

# Run ESLint with automatic fixes
npm run lint:fix

# Run TypeScript type checking (without ESLint)
npm run typecheck

# Run all checks (lint + typecheck + tests)
npm test && npm run lint && npm run typecheck
```

### ESLint Output

```bash
$ npm run lint

/path/to/file.ts
  12:5  warning  Unsafe assignment of an `any` value  @typescript-eslint/no-unsafe-assignment
  23:10 error    'foo' is never reassigned. Use 'const' instead  prefer-const

✖ 2 problems (1 error, 1 warning)
  1 error and 0 warnings potentially fixable with the `--fix` option.
```

### IDE Integration

Most IDEs automatically integrate with ESLint:

- **VS Code**: Install [ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- **WebStorm/IntelliJ**: Built-in ESLint support (enable in settings)
- **Vim/Neovim**: Use [ALE](https://github.com/dense-analysis/ale) or [coc-eslint](https://github.com/neoclide/coc-eslint)

## Troubleshooting

### Common Issues

#### 1. "Parsing error: Cannot read file 'tsconfig.json'"

**Cause**: ESLint can't find the tsconfig file specified in `parserOptions.project`

**Solution**:
```bash
# Verify tsconfig files exist
ls -la tsconfig*.json

# Check that tsconfigRootDir is correct in eslint.config.js
# Should be: tsconfigRootDir: __dirname
```

#### 2. "Warning: File ignored by default because it is located outside of the base path"

**Cause**: ESLint is trying to lint files not included in any tsconfig

**Solution**: Add the file to the appropriate `ignores` array in `eslint.config.js`:
```javascript
{
  ignores: [
    'dist/**',
    'coverage/**',
    // Add problematic paths here
  ]
}
```

#### 3. "Cannot find module '@typescript-eslint/parser'"

**Cause**: ESLint dependencies not installed

**Solution**:
```bash
npm install
```

#### 4. Type-Aware Rules Not Working

**Symptoms**: Rules like `no-unsafe-assignment` don't trigger on obvious violations

**Diagnosis**:
```bash
# Check that files are included in a tsconfig
npx tsc --listFiles | grep path/to/file.ts

# Verify ESLint is using the correct parser
npx eslint --debug path/to/file.ts 2>&1 | grep parser
```

**Solution**: Ensure the file matches the `files` pattern in the production code block and is included in either `tsconfig.json` or `tsconfig.webview.json`.

#### 5. Slow Linting Performance

**Cause**: Type-aware linting performs full TypeScript type-checking

**Solutions**:
- Only lint changed files: `npx eslint $(git diff --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$')`
- Use IDE linting for real-time feedback instead of repeated full-project lints
- Consider disabling type-aware rules for specific slow files (not recommended)

#### 6. React Hooks Rules Not Applying

**Cause**: File doesn't match the webview configuration pattern

**Solution**: Ensure React files are in `src/webview-src/**/*.tsx` and have the `.tsx` extension:
```javascript
// eslint.config.js (lines 93-114)
files: ['src/webview-src/**/*.tsx'],  // Must match this pattern
```

### Getting Help

1. Check the [TypeScript ESLint documentation](https://typescript-eslint.io/)
2. Review [ESLint flat config migration guide](https://eslint.org/docs/latest/use/configure/migration-guide)
3. Open an issue in the project repository with:
   - Full error message
   - Output of `npm run lint -- --debug`
   - Relevant file paths and configuration

## Migration Strategy

### Goal

Upgrade all type-safety warnings to errors to enforce strict type-checking across the codebase.

### Current Status

As of the latest commit, there are **type-safety warnings** in the codebase (exact count varies). These stem from:
- Unsafe `any` type usage
- Missing promise handling
- Loose type assertions

### Migration Phases

#### Phase 1: Establish Baseline (Current)
- ✅ All type-checked rules configured as warnings
- ✅ CI reports warnings but doesn't fail builds
- ✅ Developers see warnings in IDEs

#### Phase 2: Incremental Fixes
1. Run `npm run lint` to see current warnings
2. Choose a rule to focus on (e.g., `no-unsafe-assignment`)
3. Fix all violations of that rule in one PR
4. Upgrade the rule from `'warn'` to `'error'` in the same PR
5. Repeat for next rule

**Recommended order** (easiest to hardest):
1. `require-await` - Remove unnecessary `async` keywords
2. `no-floating-promises` - Add `await` or `.catch()` handlers
3. `no-misused-promises` - Fix Promise usage in conditions
4. `restrict-template-expressions` - Add `.toString()` or type guards
5. `no-unsafe-argument` - Add type guards or better types
6. `no-unsafe-call` - Add type guards or type assertions
7. `no-unsafe-return` - Fix return types
8. `no-unsafe-assignment` - Replace `any` with proper types
9. `no-unsafe-member-access` - Add type guards or interfaces

#### Phase 3: Prevent Regression
- Set up a pre-commit hook to run `npm run lint`
- Configure CI to fail on any ESLint errors
- Add rule to PR review checklist: "No new type-safety warnings"

#### Phase 4: Strict Mode (Future)
Once all warnings are resolved:
```javascript
// Enable TypeScript strict mode flags
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUncheckedIndexedAccess": true  // Extra strict
  }
}
```

### Tracking Progress

Run this command to see current warning counts by rule:

```bash
npm run lint 2>&1 | grep '@typescript-eslint' | cut -d' ' -f2- | sort | uniq -c | sort -rn
```

Example output:
```
  45 @typescript-eslint/no-unsafe-assignment
  23 @typescript-eslint/no-unsafe-member-access
  12 @typescript-eslint/no-floating-promises
   8 @typescript-eslint/no-unsafe-call
   3 @typescript-eslint/require-await
```

Track progress by running this command before and after each fix session.

---

## References

- [TypeScript ESLint - Type-Aware Linting](https://typescript-eslint.io/linting/typed-linting/)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [React Hooks Rules](https://react.dev/reference/react/hooks#rules-of-hooks)
- [Vitest Documentation](https://vitest.dev/)
- [Mocha Documentation](https://mochajs.org/)

---

**Last Updated**: November 2025
**Maintainer**: OpenHands Team
**Related PRs**: #32 (ESLint Infrastructure)
