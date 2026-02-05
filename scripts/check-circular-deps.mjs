#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = [
  {
    key: 'src',
    args: [
      '--extensions',
      'ts,tsx',
      '--circular',
      '--json',
      '--ts-config',
      'tsconfig.json',
      '--exclude',
      '^\\.\\./packages/agent-sdk-ts/dist',
      'src',
    ],
  },
  {
    key: 'agent-sdk-ts',
    args: [
      '--extensions',
      'ts',
      '--circular',
      '--json',
      '--ts-config',
      'packages/agent-sdk-ts/tsconfig.json',
      'packages/agent-sdk-ts/src',
    ],
  },
];

const ALLOWLIST_PATH = new URL('./circular-deps-allowlist.json', import.meta.url);

function isCycleArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((cycle) => Array.isArray(cycle) && cycle.every((entry) => typeof entry === 'string'));
}

function parseCycleArrayJson(raw) {
  const parsed = JSON.parse(raw);
  if (!isCycleArray(parsed)) {
    throw new Error('JSON value is not a cycle-array payload.');
  }
  return parsed;
}

function findMatchingArrayEnd(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
}

function parseEmbeddedCycleArray(raw) {
  for (let start = raw.indexOf('['); start !== -1; start = raw.indexOf('[', start + 1)) {
    const end = findMatchingArrayEnd(raw, start);
    if (end === -1) {
      continue;
    }
    const candidate = raw.slice(start, end + 1);
    try {
      return parseCycleArrayJson(candidate);
    } catch {
      // keep scanning for the next valid JSON array payload.
    }
  }
  return null;
}

export function parseCycleJson(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    return parseCycleArrayJson(trimmed);
  } catch (strictError) {
    const embedded = parseEmbeddedCycleArray(trimmed);
    if (embedded) {
      return embedded;
    }
    const strictReason = strictError instanceof Error ? strictError.message : String(strictError);
    const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
    throw new Error(`Unexpected madge output (strict parse failed: ${strictReason}): ${preview}`);
  }
}

function compareStringArrays(left, right) {
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    if (left[i] < right[i]) {
      return -1;
    }
    if (left[i] > right[i]) {
      return 1;
    }
  }
  return left.length - right.length;
}

function minRotation(items) {
  if (items.length < 2) {
    return items.slice();
  }

  const doubled = items.concat(items);
  let best = items.slice();
  for (let offset = 1; offset < items.length; offset += 1) {
    const candidate = doubled.slice(offset, offset + items.length);
    if (compareStringArrays(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

function canonicalizeCycle(cycle) {
  const normalized = cycle.map((entry) => entry.replaceAll('\\', '/'));
  const forward = minRotation(normalized);
  const reverse = minRotation([...normalized].reverse());
  return compareStringArrays(forward, reverse) <= 0 ? forward.join(' -> ') : reverse.join(' -> ');
}

function runMadge(args) {
  const binary = process.platform === 'win32' ? 'madge.cmd' : 'madge';
  const result = spawnSync(binary, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  // madge exits 1 when cycles are found; this is expected for baseline allowlist checks.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`madge failed (${result.status}): ${result.stderr || result.stdout}`);
  }

  return parseCycleJson(result.stdout ?? '');
}

function toCanonicalSet(cycles) {
  return new Set(cycles.map((cycle) => canonicalizeCycle(cycle)));
}

function sorted(set) {
  return [...set].sort((left, right) => left.localeCompare(right));
}

function difference(left, right) {
  const output = new Set();
  for (const value of left) {
    if (!right.has(value)) {
      output.add(value);
    }
  }
  return output;
}

function main() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
  let hasError = false;

  for (const target of TARGETS) {
    const actual = toCanonicalSet(runMadge(target.args));
    const expected = toCanonicalSet(allowlist[target.key] ?? []);

    const unexpected = difference(actual, expected);
    const stale = difference(expected, actual);

    console.log(`\n[cycles] ${target.key}: ${actual.size} cycle(s)`);

    if (unexpected.size > 0) {
      hasError = true;
      console.error(`[cycles] unexpected cycles in ${target.key}:`);
      for (const cycle of sorted(unexpected)) {
        console.error(`  - ${cycle}`);
      }
    }

    if (stale.size > 0) {
      hasError = true;
      console.error(`[cycles] stale allowlist entries in ${target.key} (remove these):`);
      for (const cycle of sorted(stale)) {
        console.error(`  - ${cycle}`);
      }
    }
  }

  if (hasError) {
    console.error('\nCircular dependency check failed. Update code or scripts/circular-deps-allowlist.json.');
    process.exit(1);
  }

  console.log('\nCircular dependency check passed.');
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) {
  main();
}
