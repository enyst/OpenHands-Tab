import type { ChatCompletionRequest, LLMClient } from '../llm';
import type { Message, ToolCall } from '../types';
import type { OpenHandsSettings } from '../types/settings';
import { summarizeFileChangesWithGeminiFlash } from './fileDiffSummarizer';
import { getGeminiClient } from './geminiClient';
import type { SecretRegistry } from './SecretRegistry';
import { SecretMasker } from './secretMasker';
import { toOptionalNonEmptyString } from './settingsUtils';
import { summarizeTerminalObservationWithGeminiFlash } from './terminalObservationSummarizer';
import { formatToolMessageText } from './toolMessageFormatting';
import { truncateToolMessage } from './toolResultTruncation';
import { ELLIPSIS, redactAndTruncateArgs } from './textSanitizers';

const TOOL_SUMMARY_PROFILE_ID = 'gemini-flash-summarizer';
const TOOL_SUMMARY_PROMPT_MAX_CHARS = 4_000;
const TOOL_SUMMARY_MAX_CHARS = 1_000;

export class ToolSummarizer {
  private enabled = false;
  private failed = false;
  private debug = false;
  private pendingToolSummaries: Array<{ toolName: string; summary: string }> = [];
  private client?: LLMClient;
  private clientInitPromise?: Promise<LLMClient>;

  constructor(
    private readonly deps: {
      secrets: SecretRegistry;
      secretMasker: SecretMasker;
      injectedClient?: LLMClient;
    },
  ) {}

  updateSettings(settings: OpenHandsSettings, options: { debug: boolean }): void {
    this.debug = options.debug;
    this.enabled = settings?.agent?.summarizeToolCalls ?? false;
    if (!this.enabled) {
      this.pendingToolSummaries = [];
    }

    // If the user updates settings/secrets, allow retrying tool summarization.
    this.failed = false;

    if (!this.deps.injectedClient) {
      this.client = undefined;
      this.clientInitPromise = undefined;
    }
  }

  resetPendingSummaries(): void {
    this.pendingToolSummaries = [];
  }

  buildToolSummaryMessage(): Message | undefined {
    if (!this.enabled) return undefined;
    if (!this.pendingToolSummaries.length) return undefined;

    if (this.pendingToolSummaries.length === 1) {
      const only = this.pendingToolSummaries[0];
      return {
        role: 'assistant',
        content: [{ type: 'text', text: `Tool summary (${only.toolName}): ${only.summary}` }],
      };
    }

    const lines = [
      'Tool summaries:',
      ...this.pendingToolSummaries.map((entry) => `- ${entry.toolName}: ${entry.summary}`),
    ];
    return { role: 'assistant', content: [{ type: 'text', text: lines.join('\n') }] };
  }

  async maybeSummarizeToolCall(toolCall: ToolCall, result: unknown): Promise<void> {
    if (!this.enabled) return;
    if (this.failed) return;

    try {
      const summary = await this.summarizeToolCall(toolCall, result);
      if (!summary) return;
      this.pendingToolSummaries.push({ toolName: toolCall.function.name, summary });
    } catch (error) {
      this.markFailed('[Agent] Tool call summarization failed; disabling for this session:', error);
    }
  }

  async maybeAttachFileDiffSummary(toolCall: ToolCall, result: unknown): Promise<unknown> {
    if (toolCall.function.name !== 'file_editor') return result;
    if (!this.enabled) return result;
    if (this.failed) return result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

    const record = result as Record<string, unknown>;
    const command = toOptionalNonEmptyString(record.command);
    if (command !== 'insert' && command !== 'str_replace') return result;

    if (typeof record.summary === 'string' && record.summary.trim()) return result;

    const filePath = toOptionalNonEmptyString(record.path);
    const oldContent = record.old_content;
    const newContent = record.new_content;
    const oldText = typeof oldContent === 'string' ? oldContent : oldContent === null ? '' : undefined;
    const newText = typeof newContent === 'string' ? newContent : newContent === null ? '' : undefined;
    if (!filePath || oldText === undefined || newText === undefined) return result;

    try {
      const llmClient = await this.getClient();
      const summary = await summarizeFileChangesWithGeminiFlash(
        { kind: 'contents', filePath, oldContent: oldText, newContent: newText },
        { secrets: this.deps.secrets, llmClient },
      );
      if (!summary) return result;

      return { ...record, summary };
    } catch (error) {
      this.markFailed('[Agent] File diff summarization failed; disabling for this session:', error);
      return result;
    }
  }

  async maybeAttachTerminalObservationSummary(toolCall: ToolCall, result: unknown): Promise<unknown> {
    if (toolCall.function.name !== 'terminal') return result;
    if (!this.enabled) return result;
    if (this.failed) return result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;

    const record = result as Record<string, unknown>;
    if (typeof record.summary === 'string' && record.summary.trim()) return result;

    const commandFromArgs = (() => {
      const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments);
      if (!rawArgs) return undefined;
      try {
        const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
        return toOptionalNonEmptyString(parsed.command) ?? rawArgs;
      } catch {
        return rawArgs;
      }
    })();

    const command = toOptionalNonEmptyString(record.command) ?? commandFromArgs ?? '';
    const exitCodeRaw = record.exit_code;
    const exitCode =
      typeof exitCodeRaw === 'string' || typeof exitCodeRaw === 'number'
        ? exitCodeRaw
        : exitCodeRaw === null
          ? null
          : undefined;
    const stdout = typeof record.stdout === 'string' ? record.stdout : undefined;
    const stderr = typeof record.stderr === 'string' ? record.stderr : undefined;
    const timedOut = record.timeout === true;
    const outputWasTruncated =
      (typeof stdout === 'string' && stdout.includes(ELLIPSIS)) ||
      (typeof stderr === 'string' && stderr.includes(ELLIPSIS));

    try {
      const llmClient = await this.getClient();
      const summary = await summarizeTerminalObservationWithGeminiFlash(
        {
          command,
          exit_code: exitCode,
          stdout,
          stderr,
          timedOut,
          wasTruncated: outputWasTruncated,
        },
        { secrets: this.deps.secrets, llmClient },
      );
      if (!summary) return result;

      return { ...record, summary };
    } catch (error) {
      this.markFailed('[Agent] Terminal summarization failed; disabling for this session:', error);
      return result;
    }
  }

  private async summarizeToolCall(toolCall: ToolCall, result: unknown): Promise<string | undefined> {
    const client = await this.getClient();
    const toolName = toolCall.function.name;
    const rawArgs = toOptionalNonEmptyString(toolCall.function.arguments) ?? '';
    const safeArgs = rawArgs ? redactAndTruncateArgs(rawArgs) : '';

    const formatted = formatToolMessageText(toolCall, result);
    const masked = this.deps.secretMasker.maskText(formatted);
    const clipped = truncateToolMessage(masked, TOOL_SUMMARY_PROMPT_MAX_CHARS);

    const prompt = [
      'Write a concise (1–3 sentence) summary of a tool execution performed by an autonomous coding agent.',
      '- Focus on the action taken and key outcome.',
      '- Do not include secrets or long output excerpts.',
      '',
      `Tool: ${toolName}`,
      `Arguments: ${safeArgs || '(none)'}`,
      '',
      'Result (redacted + clipped):',
      clipped || '(empty)',
    ].join('\n');

    const request: ChatCompletionRequest = {
      systemPrompt: 'You summarize tool executions for an autonomous coding agent.',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    };

    let text = '';
    for await (const chunk of client.streamChat(request)) {
      if (chunk.type === 'text') text += chunk.text;
    }

    const summary = this.deps.secretMasker.maskText(text).trim();
    if (!summary) return undefined;

    return summary.length > TOOL_SUMMARY_MAX_CHARS ? summary.slice(0, TOOL_SUMMARY_MAX_CHARS) + '…' : summary;
  }

  private async getClient(): Promise<LLMClient> {
    if (this.deps.injectedClient) return this.deps.injectedClient;
    if (this.client) return this.client;
    if (this.clientInitPromise) return this.clientInitPromise;

    this.clientInitPromise = (async () => {
      const client = await getGeminiClient(this.deps.secrets, { usageId: 'tool-summarizer', profileId: TOOL_SUMMARY_PROFILE_ID });
      this.client = client;
      return client;
    })();

    return this.clientInitPromise;
  }

  private markFailed(message: string, error: unknown): void {
    this.failed = true;
    if (this.debug) {
      console.warn(message, error);
    }
  }
}

