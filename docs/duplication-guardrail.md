# Duplication Guardrail

This repo enforces a production-code duplication budget during `npm run lint`.

## Command

```bash
npm run lint:duplication
```

The command runs `scripts/check-duplication.mjs`, which shells out to `jscpd` and checks:

- Scope: `src`, `packages/agent-sdk-ts/src`
- Formats: `typescript`, `tsx`
- Excluded from scan:
  - tests (`**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx`, `**/tests/**`)
  - generated/built assets (`**/dist/**`, `**/media/webview.js`, `**/tailwind.gen.css`)
  - declaration files (`**/*.d.ts`)

## Threshold Policy

- Current enforced threshold: **2.25% duplicated lines**
- Default mode: `error` (fails lint when threshold is exceeded)

Local override knobs for experimentation:

- `DUPLICATION_THRESHOLD` (number, 0-100)
- `DUPLICATION_MODE` (`error` or `warn`)

Examples:

```bash
DUPLICATION_MODE=warn npm run lint:duplication
DUPLICATION_THRESHOLD=2.0 npm run lint:duplication
```

## Ratchet Plan

The threshold is intentionally above current baseline to avoid churn during rollout, then tightened as refactor beads land:

1. Keep at 2.25% while existing high-duplication clusters are being reduced.
2. Lower to 2.00% after `oh-tab-zhwi.6.2` and `oh-tab-zhwi.7.1` are complete.
3. Lower to 1.75% after second-pass cleanup of `extension/secretCommands` and `webview/eventBlocks`.
4. Long-term target: 1.50%.

Any upward threshold change requires an explicit Bead note + PR explanation.
