import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ChatCompletionRequest, LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import type { SecretRegistry } from './SecretRegistry';

const execFileAsync = promisify(execFile);

export type FileChangeInput =
  | { kind: 'contents'; filePath: string; oldContent: string; newContent: string }
  | { kind: 'git_refs'; repoRoot: string; filePath: string; baseRef: string; headRef: string };

export interface SummarizeFileChangesOptions {
  secrets: SecretRegistry;
  llmClient?: LLMClient;
  execFileText?: (command: string, args: string[], cwd?: string) => Promise<string>;
  maxPromptChars?: number;
  maxSummaryChars?: number;
}

const DEFAULT_MAX_PROMPT_CHARS = 4_000;
const DEFAULT_MAX_SUMMARY_CHARS = 1_000;
const CLIP_MARKER = '<diff clipped>';

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const clipTextMiddle = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const markerBudget = CLIP_MARKER.length + 2;
  if (maxChars < markerBudget) return text.slice(0, maxChars);
  const available = maxChars - markerBudget;
  const half = Math.max(0, Math.floor(available / 2));
  return `${text.slice(0, half)}\n${CLIP_MARKER}\n${text.slice(-half)}`;
};

const getLineCount = (text: string): number => {
  if (!text) return 0;
  return text.split('\n').length;
};

const maskSecrets = (text: string, secrets: SecretRegistry): string => {
  let masked = text;
  const values = secrets
    .getRegisteredValues()
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    masked = masked.replaceAll(value, '***');
  }
  return masked;
};

const computeChangedRegion = (oldContent: string, newContent: string) => {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const minLen = Math.min(oldLines.length, newLines.length);

  let prefix = 0;
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    prefixLines: prefix,
    suffixLines: suffix,
    oldChanged: oldLines.slice(prefix, Math.max(prefix, oldLines.length - suffix)),
    newChanged: newLines.slice(prefix, Math.max(prefix, newLines.length - suffix)),
  };
};

const defaultExecFileText = async (command: string, args: string[], cwd?: string): Promise<string> => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
};

const normalizeRepoRelativePath = (repoRoot: string, filePath: string): string => {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  const relative = path.relative(repoRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside repoRoot: ${filePath}`);
  }
  return relative.split(path.sep).join('/');
};

const loadContentsFromGitRefs = async (
  input: Extract<FileChangeInput, { kind: 'git_refs' }>,
  options: Pick<SummarizeFileChangesOptions, 'execFileText'>
): Promise<{ oldContent: string; newContent: string }> => {
  const execText = options.execFileText ?? defaultExecFileText;
  const relativePath = normalizeRepoRelativePath(input.repoRoot, input.filePath);

  const readAtRef = async (ref: string): Promise<string> => {
    try {
      return await execText('git', ['show', `${ref}:${relativePath}`], input.repoRoot);
    } catch {
      return '';
    }
  };

  const [oldContent, newContent] = await Promise.all([readAtRef(input.baseRef), readAtRef(input.headRef)]);
  return { oldContent, newContent };
};

const getGeminiFlashClient = async (secrets: SecretRegistry): Promise<LLMClient> => {
  const factory = new LLMFactory(
    {
      profileId: 'gemini-flash',
      model: 'gemini-flash',
      usageId: 'file-diff-summarizer',
      temperature: 0.2,
      maxOutputTokens: 256,
    },
    { secrets }
  );
  return factory.createClient();
};

export async function summarizeFileChangesWithGeminiFlash(
  input: FileChangeInput,
  options: SummarizeFileChangesOptions
): Promise<string | undefined> {
  const maxPromptChars = toNonNegativeInt(options.maxPromptChars) || DEFAULT_MAX_PROMPT_CHARS;
  const maxSummaryChars = toNonNegativeInt(options.maxSummaryChars) || DEFAULT_MAX_SUMMARY_CHARS;

  const { oldContent, newContent } =
    input.kind === 'git_refs'
      ? await loadContentsFromGitRefs(input, options)
      : { oldContent: input.oldContent, newContent: input.newContent };

  if (oldContent === newContent) return undefined;

  const { prefixLines, suffixLines, oldChanged, newChanged } = computeChangedRegion(oldContent, newContent);
  const oldChangedText = oldChanged.join('\n');
  const newChangedText = newChanged.join('\n');

  const rawPrompt = [
    'Write a concise (1–3 sentence) summary of file changes performed by an autonomous coding agent.',
    '- Focus on what changed and the key outcome.',
    '- Do not include secrets or long code excerpts.',
    '',
    `File: ${input.filePath}`,
    `Old: ${getLineCount(oldContent)} lines, ${oldContent.length} chars`,
    `New: ${getLineCount(newContent)} lines, ${newContent.length} chars`,
    `Unchanged: ${prefixLines} prefix lines, ${suffixLines} suffix lines`,
    '',
    'Changed region (old, clipped):',
    oldChangedText || '(empty)',
    '',
    'Changed region (new, clipped):',
    newChangedText || '(empty)',
  ].join('\n');

  const safePrompt = clipTextMiddle(maskSecrets(rawPrompt, options.secrets), maxPromptChars);
  const request: ChatCompletionRequest = {
    systemPrompt: 'You summarize diffs for an IDE UI.',
    messages: [{ role: 'user', content: [{ type: 'text', text: safePrompt }] }],
  };

  const client = options.llmClient ?? (await getGeminiFlashClient(options.secrets));
  let text = '';
  for await (const chunk of client.streamChat(request)) {
    if (chunk.type === 'text') text += chunk.text;
  }

  const summary = maskSecrets(text, options.secrets).trim();
  if (!summary) return undefined;
  if (summary.length <= maxSummaryChars) return summary;
  if (maxSummaryChars <= 0) return undefined;
  if (maxSummaryChars === 1) return '…';
  return summary.slice(0, maxSummaryChars - 1) + '…';
}
