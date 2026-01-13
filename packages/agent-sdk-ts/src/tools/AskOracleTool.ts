import { z } from 'zod';
import type { ToolContext } from './types';
import { ZodTool } from './zod-tool';
import { LLMFactory } from '../sdk/llm';

const MAX_CONTEXT_CHARS = 20_000;

const askOracleSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .describe('The exact question to ask the oracle LLM.'),
  context: z
    .string()
    .optional()
    .describe('Optional additional context (code snippets, logs, etc.).'),
});

export type AskOracleToolArgs = z.infer<typeof askOracleSchema>;

export type AskOracleToolResult = string;

const normalizeNonEmptyString = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
};

const truncateContext = (raw: string): string => {
  if (raw.length <= MAX_CONTEXT_CHARS) return raw;
  const head = raw.slice(0, Math.floor(MAX_CONTEXT_CHARS / 2));
  const tail = raw.slice(-Math.floor(MAX_CONTEXT_CHARS / 2));
  return `${head}\n<context clipped>\n${tail}`;
};

export class AskOracleTool extends ZodTool<AskOracleToolArgs, AskOracleToolResult> {
  readonly name = 'ask_oracle';
  readonly description =
    'Ask a dedicated oracle LLM a question when you are unsure or want a second opinion. ' +
    'You MUST include relevant context (code snippets, logs, diagrams) so the oracle can answer correctly.';
  readonly schema = askOracleSchema;

  async execute(args: AskOracleToolArgs, context: ToolContext): Promise<AskOracleToolResult> {
    const question = normalizeNonEmptyString(args.question);
    if (!question) {
      return 'ask_oracle: question must be a non-empty string';
    }

    const oracleProfileId = normalizeNonEmptyString(context.settings?.oracle?.profileId);
    if (!oracleProfileId) {
      return 'ask_oracle is not configured. Set the oracle LLM profile id via openhands.oracle.profileId.';
    }

    const secrets = context.secrets;
    if (!secrets) {
      return 'ask_oracle cannot run because SecretRegistry is unavailable in this runtime.';
    }

    const extraContext = normalizeNonEmptyString(args.context);
    const contextBlock = extraContext
      ? `\n\n<environment/context>\n${truncateContext(extraContext)}\n</environment/context>`
      : '';

    const request = {
      systemPrompt:
        'You are an Oracle. Provide a careful, direct answer. ' +
        'If you are uncertain, say so and suggest next steps. ' +
        'Be concise unless the question asks for detail.',
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: `${question}${contextBlock}` }],
        },
      ],
    };

    try {
      const factory = new LLMFactory({
        profileId: oracleProfileId,
        // Keep model populated for error context when the profile load fails.
        model: 'oracle',
        usageId: 'oracle',
      }, {
        secrets,
        preferredApiKeys: [`openhands.llmProfileApiKey.${oracleProfileId}`],
      });

      const client = await factory.createClient();
      let text = '';
      for await (const chunk of client.streamChat(request)) {
        if (chunk.type === 'text') text += chunk.text;
      }
      const answer = text.trim();
      if (!answer) return 'ask_oracle: oracle returned an empty response';
      return answer;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `ask_oracle failed: ${reason}`;
    }
  }
}
