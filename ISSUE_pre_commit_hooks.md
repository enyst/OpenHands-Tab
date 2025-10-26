# Add Pre-Commit Hooks with Husky

## Problem
Linting only runs in CI, so developers can commit broken code and only find out later.

## Solution
Add husky + lint-staged for automatic linting before commit:

```bash
npm install --save-dev husky lint-staged
```

**package.json:**
```json
{
  "scripts": {
    "prepare": "husky install"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "git add"]
  }
}
```

**.husky/pre-commit:**
```bash
npm run lint-staged
```

## Benefits
- Catch errors before commit
- Auto-fix fixable issues
- Faster feedback loop
- Prevent broken CI builds

## Trade-offs
- Slightly slower commits
- Can be bypassed with --no-verify
- All contributors need husky

## Priority
Low - Quality of life improvement

## Related
PR #32 - ESLint Infrastructure
