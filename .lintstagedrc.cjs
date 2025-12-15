module.exports = {
  // Root extension + tests use the root eslint.config.js
  '{src,tests}/**/*.{ts,tsx}': ['eslint --max-warnings=0'],

  // The SDK has its own eslint.config.js; run its lint script in-workspace.
  'packages/agent-sdk-ts/**/*.{ts,tsx}': () => 'npm run lint -w @openhands/agent-sdk-ts',
};
