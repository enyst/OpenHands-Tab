#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * OpenAI Responses API: reasoning round-trip experiment
 *
 * Goal
 * ----
 * Empirically test how `/v1/responses` behaves in stateless mode (`store: false`)
 * when we manually manage conversation context and "round-trip" reasoning items
 * between turns.
 *
 * What we test
 * ------------
 * We run the same 3-turn conversation twice, varying how we send reasoning items
 * back in the next request `input`:
 *
 * - mode=full:
 *   Re-send the reasoning item with all fields we received (id, summary,
 *   encrypted_content, content, status).
 *
 * - mode=minimal:
 *   Re-send only the minimal subset used for stateless continuity:
 *   (id, summary, encrypted_content).
 *
 * Why this matters
 * ---------------
 * With `store: false`, OpenAI does not persist response items server-side.
 * If we send back a reasoning item that only references an `rs_*` id without
 * the returned `encrypted_content`, OpenAI may treat it as a stored reference
 * and respond with 404 ("Items are not persisted when store is set to false...").
 *
 * Security / secrets
 * ------------------
 * - This script reads ONLY `OPENAI_API_KEY` from the environment and never prints it.
 * - It does NOT read `.env` itself. Export `OPENAI_API_KEY` before running.
 *
 * Usage
 * -----
 *   # Option A: export the key explicitly
 *   export OPENAI_API_KEY="..."
 *   node scripts/test-openai-responses-reasoning.mjs minimal
 *
 *   # Option B (shell): source the repo .env for your current shell, then run
 *   set -a; source .env; set +a
 *   node scripts/test-openai-responses-reasoning.mjs full
 *
 * Modes: "full" | "minimal" | "both" (default: both)
 *
 * Artifacts
 * ---------
 * By default, this script writes sanitized request/response artifacts under:
 *   `scripts/fixtures/openai-responses/run-<timestamp>/`
 *
 * Use `--out-dir <path>` to choose a custom output directory.
 */

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5-mini';

const MODE_FULL = 'full';
const MODE_MINIMAL = 'minimal';
const MODE_BOTH = 'both';

const MAX_OUTPUT_TOKENS = 350;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_ROOT = join(SCRIPT_DIR, 'fixtures', 'openai-responses');

const apiKey = process.env.OPENAI_API_KEY;
if (typeof apiKey !== 'string' || apiKey.trim() === '') {
  console.error('Missing OPENAI_API_KEY in environment.');
  console.error('Set it via: export OPENAI_API_KEY="..."');
  process.exit(1);
}

const safeJson = (value) => JSON.stringify(value, null, 2);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const stableCopy = (value) => {
  if (Array.isArray(value)) return value.map(stableCopy);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableCopy(value[key]);
    return out;
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(stableCopy(value));

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

const summarizeDiffValue = (value) => {
  if (typeof value === 'string') {
    if (value.length <= 120) return value;
    const prefix = value.slice(0, 24);
    const suffix = value.slice(-24);
    return `<string len=${value.length} sha256=${sha256Hex(value).slice(0, 16)} prefix=${safeJson(
      prefix
    )} suffix=${safeJson(suffix)}>`;
  }
  if (Array.isArray(value)) return `<array len=${value.length}>`;
  if (isPlainObject(value)) return `<object keys=${Object.keys(value).length}>`;
  return value;
};

const diffJson = (a, b, path = '$') => {
  if (Object.is(a, b)) return [];

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  const aIsObj = isPlainObject(a);
  const bIsObj = isPlainObject(b);

  if (aIsArray !== bIsArray || aIsObj !== bIsObj || typeof a !== typeof b) {
    return [
      {
        path,
        a: summarizeDiffValue(a),
        b: summarizeDiffValue(b),
      },
    ];
  }

  if (aIsArray && bIsArray) {
    const diffs = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i += 1) diffs.push(...diffJson(a[i], b[i], `${path}[${i}]`));
    return diffs;
  }

  if (aIsObj && bIsObj) {
    const diffs = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of Array.from(keys).sort()) diffs.push(...diffJson(a[key], b[key], `${path}.${key}`));
    return diffs;
  }

  return [
    {
      path,
      a: summarizeDiffValue(a),
      b: summarizeDiffValue(b),
    },
  ];
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  let mode = MODE_BOTH;
  let outDir = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out-dir') {
      outDir = args[i + 1] || null;
      i += 1;
      continue;
    }
    if (!arg.startsWith('--')) mode = arg.toLowerCase();
  }

  return { mode, outDir };
};

const ensureDir = async (dir) => {
  await mkdir(dir, { recursive: true });
};

const writeTextArtifact = async (path, text) => {
  await writeFile(path, text, 'utf8');
};

const summarizeReasoningForLog = (item) => {
  const summary = Array.isArray(item.summary)
    ? item.summary
      .map((s) => (s && typeof s === 'object' && typeof s.text === 'string' ? s.text : null))
      .filter(Boolean)
    : [];

  const contentCount = Array.isArray(item.content) ? item.content.length : 0;
  const encrypted = typeof item.encrypted_content === 'string' ? item.encrypted_content : null;

  return {
    id: typeof item.id === 'string' ? item.id : null,
    status: typeof item.status === 'string' ? item.status : null,
    summary,
    content_count: contentCount,
    encrypted_content: encrypted ? `<redacted len=${encrypted.length}>` : null,
  };
};

const normalizeMessageForInput = (messageOutputItem) => {
  const role = messageOutputItem.role === 'assistant' ? 'assistant' : 'assistant';
  const content = Array.isArray(messageOutputItem.content) ? messageOutputItem.content : [];

  const normalizedContent = content
    .filter((part) => part && typeof part === 'object' && part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => ({ type: 'output_text', text: part.text }));

  return {
    type: 'message',
    role,
    content: normalizedContent.length ? normalizedContent : [{ type: 'output_text', text: '' }],
  };
};

const normalizeReasoningForInput = (reasoningOutputItem, mode) => {
  const id = typeof reasoningOutputItem.id === 'string' ? reasoningOutputItem.id : '';
  const summary = Array.isArray(reasoningOutputItem.summary) ? reasoningOutputItem.summary : [];
  const encrypted_content = typeof reasoningOutputItem.encrypted_content === 'string' ? reasoningOutputItem.encrypted_content : null;

  // Keep the object as close to the API schema as possible.
  const base = {
    type: 'reasoning',
    id,
    summary,
    encrypted_content,
  };

  if (mode === MODE_MINIMAL) {
    return base;
  }

  // mode=full
  const content = Array.isArray(reasoningOutputItem.content) ? reasoningOutputItem.content : undefined;
  const status = typeof reasoningOutputItem.status === 'string' ? reasoningOutputItem.status : undefined;
  return {
    ...base,
    ...(content ? { content } : {}),
    ...(status ? { status } : {}),
  };
};

const extractOutputItems = (responseJson) => (Array.isArray(responseJson.output) ? responseJson.output : []);

const extractReasoningItems = (outputItems) => outputItems.filter((item) => item && typeof item === 'object' && item.type === 'reasoning');

const extractAssistantMessageItems = (outputItems) => outputItems.filter((item) => item && typeof item === 'object' && item.type === 'message');

const extractAssistantText = (outputItems) => {
  const parts = [];
  for (const item of outputItems) {
    if (!item || typeof item !== 'object') continue;
    if (item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
};

const callResponses = async ({ input, reasoningModeLabel, outDir, turn }) => {
  const body = {
    model: MODEL,
    input,
    store: false,
    include: ['reasoning.encrypted_content'],
    reasoning: { effort: 'medium', summary: 'detailed' },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };

  const requestText = JSON.stringify(body);
  await writeTextArtifact(join(outDir, `turn${turn}_request.json`), requestText);

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: requestText,
  });

  const text = await res.text();
  await writeTextArtifact(join(outDir, `turn${turn}_response.json`), text);
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    const type = json?.error?.type || null;
    console.error(`[${reasoningModeLabel}] /v1/responses error: ${message}${type ? ` (type=${type})` : ''}`);
    if (json?.error) {
      // Safe to print; do not include request headers/body.
      console.error(`[${reasoningModeLabel}] error payload:\n${safeJson(json.error)}`);
    }
    throw new Error(message);
  }

  return json;
};

const writeReasoningArtifacts = async ({ outDir, turn, received, replayed, diffs }) => {
  await writeTextArtifact(join(outDir, `turn${turn}_reasoning_received.json`), stableStringify(received));
  await writeTextArtifact(join(outDir, `turn${turn}_reasoning_replay.json`), stableStringify(replayed));
  await writeTextArtifact(join(outDir, `turn${turn}_reasoning_diff.json`), stableStringify(diffs));
};

const runConversation = async ({ mode, outDir }) => {
  console.log(`\n=== OpenAI Responses reasoning experiment: mode=${mode} ===`);
  console.log(`model=${MODEL}, store=false, include=[reasoning.encrypted_content], reasoning.summary=detailed`);
  console.log(`artifacts: ${outDir}`);

  const prompts = [
    'Tell a short story about Napoleon. Keep it under ~120 words.',
    'Analyze historical events related to his return to the throne (the Hundred Days). Keep it under ~150 words.',
    'Think deeply about those events and give an opinion on how lessons from them can help us today. Keep it under ~150 words.',
  ];

  /** @type {any[]} */
  const input = [];

  for (let turn = 0; turn < prompts.length; turn += 1) {
    const userText = prompts[turn];
    input.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: userText }],
    });

    console.log(`\n--- Turn ${turn + 1} request ---`);
    console.log(`user: ${userText}`);

    const responseJson = await callResponses({ input, reasoningModeLabel: mode, outDir, turn: turn + 1 });
    const outputItems = extractOutputItems(responseJson);

    const assistantText = extractAssistantText(outputItems);
    const reasoningItems = extractReasoningItems(outputItems);
    const messageItems = extractAssistantMessageItems(outputItems);

    console.log(`\n--- Turn ${turn + 1} response ---`);
    console.log(`output items: ${outputItems.length} (${outputItems.map((i) => i?.type).filter(Boolean).join(', ')})`);
    console.log(`assistant text (${assistantText.length} chars):\n${assistantText}\n`);

    if (reasoningItems.length) {
      console.log(`reasoning items: ${reasoningItems.length}`);
      for (const item of reasoningItems) {
        console.log(safeJson(summarizeReasoningForLog(item)));
      }
    } else {
      console.log('reasoning items: none');
    }

    // Append reasoning + assistant message(s) into the next request context.
    // This is where we vary behavior based on `mode`.
    if (reasoningItems.length) {
      const replayed = [];
      const diffs = [];

      for (const item of reasoningItems) {
        const normalized = normalizeReasoningForInput(item, mode);
        replayed.push(normalized);
        diffs.push({
          id: typeof item.id === 'string' ? item.id : null,
          match: stableStringify(item) === stableStringify(normalized),
          differences: diffJson(item, normalized),
        });
        input.push(normalized);
      }

      await writeReasoningArtifacts({
        outDir,
        turn: turn + 1,
        received: reasoningItems,
        replayed,
        diffs,
      });
    }
    for (const item of messageItems) {
      input.push(normalizeMessageForInput(item));
    }
  }

  console.log(`\n=== Completed mode=${mode} without request errors ===`);
};

const main = async () => {
  const { mode: modeArg, outDir: outDirArg } = parseArgs();
  const mode = [MODE_FULL, MODE_MINIMAL, MODE_BOTH].includes(modeArg) ? modeArg : MODE_BOTH;

  const outRoot = outDirArg
    ? join(process.cwd(), outDirArg)
    : join(DEFAULT_OUT_ROOT, `run-${new Date().toISOString().replaceAll(':', '-')}`);

  await ensureDir(outRoot);
  await writeTextArtifact(
    join(outRoot, 'run-meta.json'),
    stableStringify({
      created_at: new Date().toISOString(),
      model: MODEL,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'medium', summary: 'detailed' },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      endpoint: OPENAI_RESPONSES_URL,
    })
  );

  if (mode === MODE_BOTH) {
    const fullDir = join(outRoot, MODE_FULL);
    const minimalDir = join(outRoot, MODE_MINIMAL);
    await ensureDir(fullDir);
    await ensureDir(minimalDir);

    await runConversation({ mode: MODE_FULL, outDir: fullDir });
    await runConversation({ mode: MODE_MINIMAL, outDir: minimalDir });
    return;
  }

  const oneDir = join(outRoot, mode);
  await ensureDir(oneDir);
  await runConversation({ mode, outDir: oneDir });
};

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
