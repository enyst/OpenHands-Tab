#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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

function parseCycleJson(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Unexpected madge output: ${trimmed}`);
  }

  return JSON.parse(trimmed.slice(start, end + 1));
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

main();
