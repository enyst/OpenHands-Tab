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

const summarizeExitCodeFallback = (exitCode: TerminalObservationInput['exit_code']): string => {
  const normalized =
    typeof exitCode === 'number' ? exitCode.toString() : typeof exitCode === 'string' && exitCode.trim() ? exitCode.trim() : 'unknown';
  return normalized === '0' ? 'Done.' : `Done (exit code ${normalized}).`;
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

  const redactedOutput = clipTextMiddle(maskSecrets(output, options.secrets), maxOutputChars, CLIP_MARKER);
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

  const safePrompt = clipTextMiddle(maskSecrets(prompt, options.secrets), maxPromptChars, CLIP_MARKER);
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
    const text = await collectStreamedText(client, request);
    const summary = maskSecrets(text, options.secrets).trim();
    if (!summary) return fallback;
    return truncateSummary(summary, maxSummaryChars);
  } catch {
    return fallback;
  }
}
