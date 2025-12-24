import type { ChatCompletionRequest, LLMClient } from '../llm';
import { LLMFactory } from '../llm';
import type { SecretRegistry } from './SecretRegistry';

export interface TerminalObservationInput {
  command: string;
  exitCode: number | string | null | undefined;
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
const DEFAULT_MAX_SUMMARY_CHARS = 1_000;
const CLIP_MARKER = '<output clipped>';

const toNonNegativeInt = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

const clipTextMiddle = (text: string, maxChars: number): string => {
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  const available = maxChars - CLIP_MARKER.length - 2;
  const half = Math.max(0, Math.floor(available / 2));
  return `${text.slice(0, half)}\n${CLIP_MARKER}\n${text.slice(-half)}`;
};

const maskSecrets = (text: string, secrets: SecretRegistry): string => {
  let masked = text;
  const values = secrets
    .getRegisteredValues()
    .map((value) => value.trim())
    .filter((value) => value.length >= 8)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    masked = masked.replaceAll(value, '***');
  }
  return masked;
};

const summarizeExitCodeFallback = (exitCode: TerminalObservationInput['exitCode']): string => {
  const normalized =
    typeof exitCode === 'number' ? exitCode.toString() : typeof exitCode === 'string' && exitCode.trim() ? exitCode.trim() : 'unknown';
  return normalized === '0' ? 'Done.' : `Done (exit code ${normalized}).`;
};

const getGeminiFlashClient = async (secrets: SecretRegistry): Promise<LLMClient> => {
  const factory = new LLMFactory(
    {
      profileId: 'gemini-flash',
      model: 'gemini-flash',
      usageId: 'terminal-observation-summarizer',
      temperature: 0.2,
      maxOutputTokens: 256,
    },
    { secrets }
  );
  return factory.createClient();
};

export async function summarizeTerminalObservationWithGeminiFlash(
  input: TerminalObservationInput,
  options: SummarizeTerminalObservationOptions
): Promise<string> {
  const maxOutputChars = toNonNegativeInt(options.maxOutputChars) || DEFAULT_MAX_OUTPUT_CHARS;
  const maxPromptChars = toNonNegativeInt(options.maxPromptChars) || DEFAULT_MAX_PROMPT_CHARS;
  const maxSummaryChars = toNonNegativeInt(options.maxSummaryChars) || DEFAULT_MAX_SUMMARY_CHARS;

  const fallback = summarizeExitCodeFallback(input.exitCode);
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
    `Exit code: ${input.exitCode ?? 'unknown'}`,
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
    const client = options.llmClient ?? (await getGeminiFlashClient(options.secrets));
    let text = '';
    for await (const chunk of client.streamChat(request)) {
      if (chunk.type === 'text') text += chunk.text;
    }
    const summary = maskSecrets(text, options.secrets).trim();
    if (!summary) return fallback;
    return summary.length > maxSummaryChars ? summary.slice(0, maxSummaryChars) + '…' : summary;
  } catch {
    return fallback;
  }
}

