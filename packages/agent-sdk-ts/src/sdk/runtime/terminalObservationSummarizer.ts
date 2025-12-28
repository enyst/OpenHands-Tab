import type { ChatCompletionRequest, LLMClient } from '../llm';
import { getGeminiClient } from './geminiClient';
import type { SecretRegistry } from './SecretRegistry';

export interface TerminalObservationInput {
  command: string;
  exit_code: number | string | null | undefined;
  stdout?: string | null;
  stderr?: string | null;
  timedOut?: boolean;
  wasTruncated?: boolean;
}

export interface SummarizeTerminalObservationOptions {
  secrets: SecretRegistry;
  llmClient?: LLMClient;
  maxOutputChars?: number;
  maxPromptChars?: number;
  maxSummaryChars?: number;
}

const DEFAULT_MAX_OUTPUT_CHARS = 4_000;
const DEFAULT_MAX_PROMPT_CHARS = 6_000;
// Increased from 1000 to reduce mid-sentence truncation (see oh-tab-qxzs)
const DEFAULT_MAX_SUMMARY_CHARS = 5_000;
const CLIP_MARKER = '<output clipped>';

const resolveNonNegativeIntOption = (value: unknown, defaultValue: number): number => {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(0, Math.trunc(value));
};

const clipTextMiddle = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const markerBudget = CLIP_MARKER.length + 2;
  if (maxChars < markerBudget) return text.slice(0, maxChars);
  const available = maxChars - markerBudget;
  const headLen = Math.ceil(available / 2);
  const tailLen = Math.floor(available / 2);
  const head = text.slice(0, headLen);
  const tail = tailLen === 0 ? '' : text.slice(-tailLen);
  return `${head}\n${CLIP_MARKER}\n${tail}`;
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

const summarizeExitCodeFallback = (exitCode: TerminalObservationInput['exit_code']): string => {
  const normalized =
    typeof exitCode === 'number' ? exitCode.toString() : typeof exitCode === 'string' && exitCode.trim() ? exitCode.trim() : 'unknown';
  return normalized === '0' ? 'Done.' : `Done (exit code ${normalized}).`;
};

const truncateSummary = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return '…';
  return text.slice(0, maxChars - 1) + '…';
};

export async function summarizeTerminalObservationWithGeminiFlash(
  input: TerminalObservationInput,
  options: SummarizeTerminalObservationOptions
): Promise<string> {
  const maxOutputChars = resolveNonNegativeIntOption(options.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS);
  const maxPromptChars = resolveNonNegativeIntOption(options.maxPromptChars, DEFAULT_MAX_PROMPT_CHARS);
  const maxSummaryChars = resolveNonNegativeIntOption(options.maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS);

  const fallback = truncateSummary(summarizeExitCodeFallback(input.exit_code), maxSummaryChars);
  const stdout = typeof input.stdout === 'string' ? input.stdout.trimEnd() : '';
  const stderr = typeof input.stderr === 'string' ? input.stderr.trimEnd() : '';
  const output = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;

  const redactedOutput = clipTextMiddle(maskSecrets(output, options.secrets), maxOutputChars);
  const prompt = [
    'Write a concise (1–3 sentence) summary of a terminal command execution performed by an autonomous coding agent.',
    '- Focus on the action taken and key outcome.',
    '- Do not include secrets or long output excerpts.',
    '',
    `Command: ${input.command || '(empty)'}`,
    `Exit code: ${input.exit_code ?? 'unknown'}`,
    `Timed out: ${input.timedOut ? 'yes' : 'no'}`,
    `Output truncated: ${input.wasTruncated ? 'yes' : 'no'}`,
    '',
    'Output (redacted + clipped):',
    redactedOutput || '(empty)',
  ].join('\n');

  const safePrompt = clipTextMiddle(maskSecrets(prompt, options.secrets), maxPromptChars);
  const request: ChatCompletionRequest = {
    systemPrompt: 'You summarize terminal tool results for an IDE UI.',
    messages: [{ role: 'user', content: [{ type: 'text', text: safePrompt }] }],
  };

  try {
    const client =
      options.llmClient ??
      (await getGeminiClient(options.secrets, {
        usageId: 'terminal-observation-summarizer',
        profileId: 'gemini-flash-summarizer',
      }));
    let text = '';
    for await (const chunk of client.streamChat(request)) {
      if (chunk.type === 'text') text += chunk.text;
    }
    const summary = maskSecrets(text, options.secrets).trim();
    if (!summary) return fallback;
    return truncateSummary(summary, maxSummaryChars);
  } catch {
    return fallback;
  }
}
