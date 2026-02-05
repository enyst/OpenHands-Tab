import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ChatCompletionRequest, LLMClient } from '../llm';
import { getGeminiClient } from './geminiClient';
import type { SecretRegistry } from './SecretRegistry';
import {
  clipTextMiddle,
  collectStreamedText,
  maskSecrets,
  resolveNonNegativeIntOption,
  truncateSummary,
} from './summarizerCommon';

const execFileAsync = promisify(execFile);

export type GitChangeSetInput =
  | {
    kind: 'ref_range';
    repoRoot: string;
    fromRef: string;
    toRef: string;
    pathFilters?: string[];
  }
  | {
    kind: 'commit_list';
    repoRoot: string;
    commits: string[];
    pathFilters?: string[];
  };

export interface GitChangeFileSummary {
  path: string;
  summary: string;
}

export interface GitChangeSetSummary {
  overallSummary: string;
  fileSummaries: GitChangeFileSummary[];
}

export interface SummarizeGitChangesOptions {
  secrets: SecretRegistry;
  llmClient?: LLMClient;
  execFileText?: (command: string, args: string[], cwd?: string) => Promise<string>;
  maxDiffChars?: number;
  maxPromptChars?: number;
  maxOverallChars?: number;
  maxFileSummaryChars?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_DIFF_CHARS = 12_000;
const DEFAULT_MAX_PROMPT_CHARS = 16_000;
const DEFAULT_MAX_OVERALL_CHARS = 1_200;
const DEFAULT_MAX_FILE_SUMMARY_CHARS = 400;
const DEFAULT_MAX_FILES = 15;
const CLIP_MARKER = '<diff clipped>';

const defaultExecFileText = async (command: string, args: string[], cwd?: string): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
};

const normalizeRepoRelativePath = (repoRoot: string, filePath: string): string => {
  const resolved = path.resolve(repoRoot, filePath);
  const relative = path.relative(repoRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside repoRoot: ${filePath}`);
  }
  return relative.split(path.sep).join('/');
};

const normalizePathFilters = (repoRoot: string, filters: string[] | undefined): string[] => {
  if (!filters) return [];
  return filters
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .map((candidate) => normalizeRepoRelativePath(repoRoot, candidate));
};

const extractJsonObject = (text: string): string | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  return text.slice(start, end + 1);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSummary = (raw: string): GitChangeSetSummary | null => {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const overall = typeof parsed.overallSummary === 'string' ? parsed.overallSummary.trim() : '';
  const filesRaw = parsed.fileSummaries;
  const fileSummaries: GitChangeFileSummary[] = Array.isArray(filesRaw)
    ? filesRaw
      .map((item): GitChangeFileSummary | null => {
        if (!isRecord(item)) return null;
        const filePath = typeof item.path === 'string' ? item.path.trim() : '';
        const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
        if (!filePath || !summary) return null;
        return { path: filePath, summary };
      })
      .filter((entry): entry is GitChangeFileSummary => Boolean(entry))
    : [];

  if (!overall && fileSummaries.length === 0) return null;
  return { overallSummary: overall, fileSummaries };
};

const resolveRangeSpec = (input: GitChangeSetInput): { repoRoot: string; rangeSpec: string; pathFilters: string[] } => {
  const repoRoot = input.repoRoot;
  const pathFilters = normalizePathFilters(repoRoot, input.pathFilters);
  if (input.kind === 'ref_range') {
    return {
      repoRoot,
      rangeSpec: `${input.fromRef}..${input.toRef}`,
      pathFilters,
    };
  }
  if (input.commits.length === 0) {
    throw new Error('commit_list requires at least one commit');
  }
  const baseRef = `${input.commits[0]}^`;
  const headRef = input.commits[input.commits.length - 1];
  return {
    repoRoot,
    rangeSpec: `${baseRef}..${headRef}`,
    pathFilters,
  };
};

export async function summarizeGitChangesWithGeminiFlash(
  input: GitChangeSetInput,
  options: SummarizeGitChangesOptions,
): Promise<GitChangeSetSummary | undefined> {
  const maxDiffChars = resolveNonNegativeIntOption(options.maxDiffChars, DEFAULT_MAX_DIFF_CHARS);
  const maxPromptChars = resolveNonNegativeIntOption(options.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS);
  const maxOverallChars = resolveNonNegativeIntOption(options.maxOverallChars, DEFAULT_MAX_OVERALL_CHARS);
  const maxFileSummaryChars = resolveNonNegativeIntOption(options.maxFileSummaryChars, DEFAULT_MAX_FILE_SUMMARY_CHARS);
  const maxFiles = resolveNonNegativeIntOption(options.maxFiles, DEFAULT_MAX_FILES);

  if (maxPromptChars <= 0 || maxOverallChars <= 0 || maxFileSummaryChars <= 0 || maxFiles <= 0) return undefined;

  const execText = options.execFileText ?? defaultExecFileText;
  const { repoRoot, rangeSpec, pathFilters } = resolveRangeSpec(input);
  const nameStatus = await execText('git', ['diff', '--name-status', rangeSpec, '--', ...pathFilters], repoRoot);
  const patch = await execText('git', ['diff', '--no-color', '--patch', rangeSpec, '--', ...pathFilters], repoRoot);

  const nameStatusText = nameStatus.trimEnd();
  const patchText = patch.trimEnd();
  if (!nameStatusText && !patchText) return undefined;

  const clippedPatch = clipTextMiddle(patchText, maxDiffChars, CLIP_MARKER);
  const rawPrompt = [
    'Summarize a multi-commit git change set for an IDE UI.',
    '',
    'Return JSON only (no markdown) matching this shape:',
    '{ "overallSummary": string, "fileSummaries": Array<{ "path": string, "summary": string }> }',
    '',
    '- overallSummary: 1–3 sentences, describe intent/behavior.',
    `- fileSummaries: up to ${maxFiles} important files with 1 sentence each.`,
    '- Do not include secrets or code excerpts.',
    '',
    `Range: ${rangeSpec}`,
    pathFilters.length ? `Path filters: ${pathFilters.join(', ')}` : 'Path filters: (none)',
    '',
    'Changed files (name-status):',
    nameStatusText || '(empty)',
    '',
    'Unified diff (clipped):',
    clippedPatch || '(empty)',
  ].join('\n');

  const safePrompt = clipTextMiddle(maskSecrets(rawPrompt, options.secrets), maxPromptChars, CLIP_MARKER);
  const request: ChatCompletionRequest = {
    systemPrompt: 'You summarize git diffs for an IDE UI.',
    messages: [{ role: 'user', content: [{ type: 'text', text: safePrompt }] }],
  };

  const client =
    options.llmClient ??
    (await getGeminiClient(options.secrets, {
      usageId: 'git-change-summarizer',
      profileId: 'gemini-flash-summarizer',
    }));
  const text = await collectStreamedText(client, request);

  const redacted = maskSecrets(text, options.secrets).trim();
  if (!redacted) return undefined;

  const parsed = parseSummary(redacted);
  if (!parsed) {
    return { overallSummary: truncateSummary(redacted, maxOverallChars), fileSummaries: [] };
  }

  const overallSummary = parsed.overallSummary ? truncateSummary(parsed.overallSummary, maxOverallChars) : '';
  const fileSummaries = parsed.fileSummaries
    .slice(0, maxFiles)
    .map((entry) => ({ path: entry.path, summary: truncateSummary(entry.summary, maxFileSummaryChars) }))
    .filter((entry) => entry.path && entry.summary);

  if (!overallSummary && fileSummaries.length === 0) return undefined;
  return { overallSummary, fileSummaries };
}
