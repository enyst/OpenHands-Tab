#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Condensation smoke script (manual; NOT run in CI).
 *
 * Purpose:
 * - Forces a real LLM request to exceed context limits by seeding huge MessageEvents.
 * - Confirms the agent recovers via condensation:
 *   context-limit error -> Condensation event emitted -> request retried -> run completes.
 *
 * Prereqs:
 * - Build the SDK first so `packages/agent-sdk-ts/dist/index.cjs` exists:
 *   `npm run build -w @openhands/agent-sdk-ts`
 *
 * Usage:
 * - `OPENAI_API_KEY=... node scripts/condensation-smoke.cjs`
 *
 * Optional env vars:
 * - `OH_SMOKE_MODEL` (default: gpt-4o-mini)
 * - `OH_SMOKE_PROVIDER` (default: openai)
 * - `OH_SMOKE_API_KEY` (alternative to OPENAI_API_KEY)
 * - `OH_SMOKE_SEED_MESSAGES` (default: 10)
 * - `OH_SMOKE_SEED_CHARS` (default: 200000) per seeded message
 */

const fs = require('fs');
const path = require('path');

const distEntry = path.join(__dirname, '..', 'packages', 'agent-sdk-ts', 'dist', 'index.cjs');
if (!fs.existsSync(distEntry)) {
  console.error('[condensation-smoke] Missing SDK build:', distEntry);
  console.error('[condensation-smoke] Run: npm run build -w @openhands/agent-sdk-ts');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Agent, EventLog } = require(distEntry);

const provider = (process.env.OH_SMOKE_PROVIDER || 'openai').trim();
const model = (process.env.OH_SMOKE_MODEL || 'gpt-4o-mini').trim();
const apiKey = (process.env.OH_SMOKE_API_KEY || process.env.OPENAI_API_KEY || '').trim();

if (!apiKey) {
  console.error('[condensation-smoke] Missing API key.');
  console.error('[condensation-smoke] Set OPENAI_API_KEY (or OH_SMOKE_API_KEY) in your environment.');
  process.exit(1);
}

const seedMessages = Math.max(6, Math.trunc(Number(process.env.OH_SMOKE_SEED_MESSAGES || 10)));
const seedChars = Math.max(10_000, Math.trunc(Number(process.env.OH_SMOKE_SEED_CHARS || 200_000)));

const makeSeedText = (label, size) => {
  const header = `== ${label} ==\n`;
  const fill = 'x'.repeat(Math.max(0, size - header.length));
  return header + fill;
};

const log = new EventLog();

let condensationEvents = 0;
let conversationErrors = 0;
log.on((event) => {
  if (event.kind === 'Condensation') {
    condensationEvents += 1;
    const forgotten = Array.isArray(event.forgotten_event_ids) ? event.forgotten_event_ids.length : 0;
    const summaryLen = typeof event.summary === 'string' ? event.summary.length : 0;
    console.log(`[condensation-smoke] Condensation emitted: forgotten=${forgotten} summaryChars=${summaryLen}`);
    return;
  }
  if (event.kind === 'ConversationErrorEvent') {
    conversationErrors += 1;
    console.log(`[condensation-smoke] ConversationErrorEvent: code=${event.code || '(none)'}`);
  }
});

for (let i = 0; i < seedMessages; i += 1) {
  const role = i % 2 === 0 ? 'user' : 'assistant';
  const source = i % 2 === 0 ? 'user' : 'agent';
  log.push({
    kind: 'MessageEvent',
    source,
    llm_message: {
      role,
      content: [{ type: 'text', text: makeSeedText(`seed ${i + 1}/${seedMessages}`, seedChars) }],
    },
  });
}

const settings = {
  llm: { model, provider },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: { policy: 'never' },
  secrets: { llmApiKey: apiKey },
};

async function main() {
  console.log('[condensation-smoke] Starting…');
  console.log(`[condensation-smoke] provider=${provider} model=${model}`);
  console.log(`[condensation-smoke] seededMessages=${seedMessages} seedCharsPerMessage=${seedChars.toLocaleString()}`);

  const agent = new Agent({ settings, events: log });
  await agent.run('Reply with exactly: OK');

  console.log('[condensation-smoke] Done.');
  console.log(`[condensation-smoke] condensations=${condensationEvents} conversationErrors=${conversationErrors}`);

  if (condensationEvents === 0) {
    console.error('[condensation-smoke] No Condensation event observed; try increasing OH_SMOKE_SEED_CHARS.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[condensation-smoke] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

