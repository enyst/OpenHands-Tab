import { z, type ZodTypeAny } from 'zod';
import type { LLMToolDefinition } from '../sdk/llm';
import type { ToolContext, ToolHandler } from './types';

export interface ToolMetadata {
  description: string;
  parameters: Record<string, unknown>;
}

export abstract class ZodTool<TArgs, TResult> implements ToolHandler<TArgs, TResult> {
  abstract readonly name: string;
  abstract readonly schema: ZodTypeAny;
  abstract readonly description: string;
  abstract readonly parameters: Record<string, unknown>;

  validate(input: unknown): TArgs {
    return this.schema.parse(input) as TArgs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_args: TArgs, _context: ToolContext): Promise<TResult> {
    throw new Error('Execute must be implemented by subclasses');
  }

  getToolDefinition(): LLMToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

export const booleanWithDefault = (defaultValue: boolean) => z.boolean().optional().default(defaultValue);

