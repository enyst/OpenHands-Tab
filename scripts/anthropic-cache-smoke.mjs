#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

import {
  Agent,
  EventLog,
  ConversationStats,
  TerminalTool,
  FileEditorTool,
  FinishTool,
} from '../packages/agent-sdk/dist/index.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKSPACE_ROOT = path.resolve(path.join(path.dirname(SCRIPT_PATH), '..'));
const OPENHANDS_HOME = path.join(os.homedir(), '.openhands');
const PROFILE_ID = process.argv[2] ?? 'opus-46';
const PROFILE_PATH = path.join(OPENHANDS_HOME, 'llm-profiles', `${PROFILE_ID}.json`);

const MESSAGES = [
  'Reply with exactly "cache-smoke-ready". Do not use any tools.',
  'Use the terminal tool exactly once with {"command":"pwd"} and then reply with just the directory path. Do not use any other tools.',
  'How many tools have you used so far in this conversation? Reply with only the number. Do not use any tools.',
  'Use the file_editor tool exactly once with {"command":"view","path":"package.json","view_range":[1,20]} and then reply with just the top-level package name. Do not use any other tools.',
  'In one short sentence, summarize the two tool results from this conversation. Do not use any tools.',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function truncate(text, maxChars = 200) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}...`;
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function findSettingsApiKey(profileBaseUrl) {
  const settingsDir = OPENHANDS_HOME;
  const entries = fs.readdirSync(settingsDir)
    .filter((name) => /^settings.*\.json$/.test(name))
    .map((name) => path.join(settingsDir, name));

  const normalizedProfileBaseUrl = typeof profileBaseUrl === 'string'
    ? profileBaseUrl.replace(/\/+$/, '')
    : '';

  let fallback;
  for (const filePath of entries) {
    let parsed;
    try {
      parsed = readJson(filePath);
    } catch {
      continue;
    }

    const apiKey = typeof parsed?.llm_api_key === 'string' ? parsed.llm_api_key.trim() : '';
    if (!apiKey) continue;

    const baseUrl = typeof parsed?.llm_base_url === 'string' ? parsed.llm_base_url.replace(/\/+$/, '') : '';
    if (!fallback) {
      fallback = { apiKey, source: filePath };
    }

    if (normalizedProfileBaseUrl && baseUrl === normalizedProfileBaseUrl) {
      return { apiKey, source: filePath };
    }
  }

  if (fallback) return fallback;
  throw new Error(`Could not find a local OpenHands settings file with an API key under ${settingsDir}`);
}

function extractAssistantText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return truncate(content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n\n'));
}

function assistantMessageEventText(event) {
  const content = Array.isArray(event?.llm_message?.content) ? event.llm_message.content : [];
  return truncate(content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n\n'));
}

function summarizeObservation(observation) {
  if (typeof observation === 'string') return truncate(observation);
  const obj = toObject(observation);
  if (!obj) return truncate(JSON.stringify(observation));
  if (typeof obj.stdout === 'string' && obj.stdout.trim()) return truncate(obj.stdout);
  if (typeof obj.stderr === 'string' && obj.stderr.trim()) return truncate(obj.stderr);
  if (typeof obj.new_content === 'string' && obj.new_content.trim()) return truncate(obj.new_content);
  if (typeof obj.old_content === 'string' && obj.old_content.trim()) return truncate(obj.old_content);
  if (typeof obj.reason === 'string' && obj.reason.trim()) return truncate(obj.reason);
  return truncate(JSON.stringify(obj));
}

function tokenUsageDelta(before, after) {
  const a = toObject(after) ?? {};
  const b = toObject(before) ?? {};
  return {
    promptTokens: Math.max(0, Number(a.promptTokens ?? 0) - Number(b.promptTokens ?? 0)),
    completionTokens: Math.max(0, Number(a.completionTokens ?? 0) - Number(b.completionTokens ?? 0)),
    cacheReadTokens: Math.max(0, Number(a.cacheReadTokens ?? 0) - Number(b.cacheReadTokens ?? 0)),
    cacheWriteTokens: Math.max(0, Number(a.cacheWriteTokens ?? 0) - Number(b.cacheWriteTokens ?? 0)),
    reasoningTokens: Math.max(0, Number(a.reasoningTokens ?? 0) - Number(b.reasoningTokens ?? 0)),
    perTurnToken: Math.max(0, Number(a.promptTokens ?? 0) - Number(b.promptTokens ?? 0))
      + Math.max(0, Number(a.completionTokens ?? 0) - Number(b.completionTokens ?? 0)),
  };
}

function countCacheControls(value) {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countCacheControls(item), 0);
  let total = 0;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'cache_control') total += 1;
    total += countCacheControls(child);
  }
  return total;
}

function summarizeRequestBody(body) {
  const payload = toObject(body);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const system = payload?.system;
  return {
    cacheControlCount: countCacheControls(payload),
    messageCount: messages.length,
    systemBlockCount: Array.isArray(system) ? system.length : (system ? 1 : 0),
  };
}

function extractToolUses(newEvents) {
  const observationsByToolCallId = new Map();
  for (const event of newEvents) {
    if (event?.kind === 'ObservationEvent' && typeof event.tool_call_id === 'string') {
      observationsByToolCallId.set(event.tool_call_id, summarizeObservation(event.observation));
    }
  }

  return newEvents
    .filter((event) => event?.kind === 'ActionEvent')
    .map((event) => {
      const action = toObject(event.action) ?? {};
      return {
        tool: event.tool_name,
        toolCallId: event.tool_call_id,
        action: action,
        observationPreview: observationsByToolCallId.get(event.tool_call_id) ?? null,
      };
    });
}

const profile = readJson(PROFILE_PATH);
const { apiKey, source: apiKeySource } = findSettingsApiKey(profile.baseUrl);

const wireRequests = [];
const normalizedProfileBaseUrl = typeof profile.baseUrl === 'string'
  ? profile.baseUrl.replace(/\/+$/, '')
  : '';
const originalFetch = globalThis.fetch;

if (typeof originalFetch !== 'function') {
  throw new Error('global fetch is not available in this Node runtime');
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' || input instanceof URL
    ? String(input)
    : input?.url;

  const normalizedUrl = typeof url === 'string' ? url.replace(/\/+$/, '') : '';
  let parsedBody = null;
  if (typeof init?.body === 'string') {
    try {
      parsedBody = JSON.parse(init.body);
    } catch {
      parsedBody = null;
    }
  }

  if (normalizedProfileBaseUrl && typeof normalizedUrl === 'string' && normalizedUrl.startsWith(normalizedProfileBaseUrl)) {
    wireRequests.push({
      url,
      method: init?.method ?? (input && typeof input === 'object' && 'method' in input ? input.method : 'GET'),
      ...summarizeRequestBody(parsedBody),
    });
  }

  return originalFetch(input, init);
};

const events = new EventLog();
const stats = new ConversationStats();
const agent = new Agent({
  workspaceRoot: WORKSPACE_ROOT,
  events,
  conversationStats: stats,
  includeDefaultTools: false,
  tools: [
    new FinishTool(),
    new TerminalTool(),
    new FileEditorTool(),
  ],
  settings: {
    llm: { profileId: PROFILE_ID },
    agent: { enableSecurityAnalyzer: false },
    conversation: { maxIterations: 12 },
    confirmation: { policy: 'never' },
    secrets: { llmApiKey: apiKey },
  },
});

const runResults = [];

for (let index = 0; index < MESSAGES.length; index += 1) {
  const message = MESSAGES[index];
  const beforeEventCount = events.list().length;
  const beforeWireCount = wireRequests.length;
  const beforeMetrics = stats.getCombinedMetrics().getSnapshot();

  const response = await agent.run(message);

  const afterEvents = events.list().slice(beforeEventCount);
  const afterWire = wireRequests.slice(beforeWireCount);
  const afterMetrics = stats.getCombinedMetrics().getSnapshot();
  const delta = tokenUsageDelta(beforeMetrics.accumulatedTokenUsage, afterMetrics.accumulatedTokenUsage);
  const assistantMessages = afterEvents.filter(
    (event) => event?.kind === 'MessageEvent' && event?.llm_message?.role === 'assistant',
  );
  const errors = afterEvents.filter(
    (event) => event?.kind === 'ConversationErrorEvent' || event?.kind === 'AgentErrorEvent',
  );

  runResults.push({
    call: index + 1,
    userPrompt: message,
    finalAssistantText: extractAssistantText(response),
    assistantMessages: assistantMessages.map(assistantMessageEventText).filter(Boolean),
    toolUses: extractToolUses(afterEvents),
    llmRequestCount: afterWire.length,
    requestCacheControlCounts: afterWire.map((request) => request.cacheControlCount),
    usage: delta,
    cacheHit: delta.cacheReadTokens > 0,
    errors: errors.map((event) => ({
      kind: event.kind,
      code: event.code ?? null,
      detail: truncate(event.detail ?? event.error ?? ''),
    })),
  });
}

const output = {
  profileId: PROFILE_ID,
  model: profile.model,
  provider: profile.provider,
  baseUrl: profile.baseUrl,
  workspaceRoot: WORKSPACE_ROOT,
  apiKeySource,
  runResults,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
