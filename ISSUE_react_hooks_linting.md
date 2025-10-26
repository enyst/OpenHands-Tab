# Add React Hooks ESLint Plugin

## Problem
Webview code uses React 19 hooks extensively but we're not linting for common mistakes like:
- Missing dependencies in useEffect/useMemo/useCallback
- Rules of Hooks violations
- Stale closures

CodeRabbit flagged this in PR #32 review.

## Solution
1. Install: `npm install --save-dev eslint-plugin-react-hooks`

2. Add to eslint.config.js:
```javascript
const reactHooks = require('eslint-plugin-react-hooks');

{
  files: ['src/webview-src/**/*.tsx'],
  plugins: {
    'react-hooks': reactHooks,
  },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
}
```

## Files
- package.json
- eslint.config.js

## Priority
High - Quick win, prevents React bugs

## Related
PR #32 - ESLint Infrastructure
