#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = ['src', 'packages/agent-sdk/src'];
const IGNORE_PATTERNS = [
  '**/__tests__/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/dist/**',
  '**/media/webview.js',
  '**/tailwind.gen.css',
  '**/tests/**',
  '**/*.d.ts',
];

const DEFAULT_THRESHOLD = 2.25;
const DEFAULT_MODE = 'error';

function resolveThreshold(raw) {
  if (!raw) {
    return DEFAULT_THRESHOLD;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid DUPLICATION_THRESHOLD="${raw}". Expected a number between 0 and 100.`);
  }

  return parsed;
}

function resolveMode(raw) {
  const normalized = (raw || DEFAULT_MODE).trim().toLowerCase();
  if (normalized === 'error' || normalized === 'warn') {
    return normalized;
  }

  throw new Error(`Invalid DUPLICATION_MODE="${raw}". Expected "error" or "warn".`);
}

function formatPct(value) {
  return `${value.toFixed(2)}%`;
}

function readReport(reportPath) {
  const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
  const stats = parsed?.statistics?.total;
  if (!stats) {
    throw new Error(`Missing statistics.total in ${reportPath}.`);
  }

  const percentageRaw = stats.percentage;
  const percentage = typeof percentageRaw === 'number' ? percentageRaw : Number(percentageRaw);
  if (!Number.isFinite(percentage)) {
    throw new Error(`Invalid duplication percentage in ${reportPath}.`);
  }

  return {
    report: parsed,
    percentage,
    totalLines: Number(stats.lines ?? 0),
    duplicatedLines: Number(stats.duplicatedLines ?? 0),
    clones: Number(stats.clones ?? 0),
  };
}

function topCloneSummaries(report, limit = 5) {
  if (!Array.isArray(report.duplicates)) {
    return [];
  }

  return [...report.duplicates]
    .sort((left, right) => (Number(right.lines ?? 0) - Number(left.lines ?? 0)))
    .slice(0, limit)
    .map((clone) => {
      const first = clone.firstFile;
      const second = clone.secondFile;
      const lines = Number(clone.lines ?? 0);
      if (!first || !second || typeof first.name !== 'string' || typeof second.name !== 'string') {
        return `${lines} lines (unattributed clone)`;
      }

      return `${lines} lines: ${first.name}:${first.start} <-> ${second.name}:${second.start}`;
    });
}

export function runDuplicationCheck(options = {}) {
  const threshold = options.threshold ?? resolveThreshold(process.env.DUPLICATION_THRESHOLD);
  const mode = options.mode ?? resolveMode(process.env.DUPLICATION_MODE);

  const outputDir = mkdtempSync(join(tmpdir(), 'oh-tab-jscpd-'));
  try {
    const binary = process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd';
    const result = spawnSync(
      binary,
      [
        '--format',
        'typescript,tsx',
        '--min-lines',
        '8',
        '--min-tokens',
        '60',
        '--reporters',
        'json',
        '--output',
        outputDir,
        '--ignore',
        IGNORE_PATTERNS.join(','),
        ...TARGETS,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
      },
    );

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`jscpd failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
    }

    const reportPath = join(outputDir, 'jscpd-report.json');
    const { report, percentage, totalLines, duplicatedLines, clones } = readReport(reportPath);
    const summary = `[duplication] total ${formatPct(percentage)} (${duplicatedLines}/${totalLines} lines, ${clones} clone(s)); threshold ${formatPct(threshold)}`;

    console.log(summary);

    const topClones = topCloneSummaries(report);
    if (topClones.length > 0) {
      console.log('[duplication] top clone hotspots:');
      for (const clone of topClones) {
        console.log(`  - ${clone}`);
      }
    }

    const overThreshold = percentage > threshold;
    if (overThreshold && mode === 'error') {
      console.error(`[duplication] threshold exceeded. Reduce duplication below ${formatPct(threshold)} or raise only with explicit policy update.`);
      return { ok: false, percentage, threshold, mode };
    }

    if (overThreshold) {
      console.warn(`[duplication] threshold exceeded but allowed in warn mode (${mode}).`);
    }

    return { ok: true, percentage, threshold, mode };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) {
  try {
    const result = runDuplicationCheck();
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[duplication] check failed: ${message}`);
    process.exit(1);
  }
}
