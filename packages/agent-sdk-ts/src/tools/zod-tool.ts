import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LLMToolDefinition } from '../sdk/llm';
import type { ToolContext, ToolDefinition } from './types';

export interface ToolMetadata {
  description: string;
  parameters: Record<string, unknown>;
}

export abstract class ZodTool<TArgs, TResult> implements ToolDefinition<TArgs, TResult> {
  abstract readonly name: string;
  abstract readonly schema: ZodTypeAny;
  abstract readonly description: string;
  protected readonly parameterSchema?: Record<string, unknown>;

  validate(input: unknown): TArgs {
    return this.schema.parse(input) as TArgs;
  }

  abstract execute(args: TArgs, context: ToolContext): Promise<TResult>;

  get parameters(): Record<string, unknown> {
    if (this.parameterSchema) return this.parameterSchema;

    const toJsonSchema = zodToJsonSchema as (schema: ZodTypeAny, options?: Record<string, unknown>) => Record<string, unknown>;
    const schemaJson = toJsonSchema(this.schema, {
      name: `${this.name}_schema`,
      $refStrategy: 'none',
    });

    const { definitions, $ref, ...jsonSchema } = schemaJson;

    if (typeof $ref === 'string' && definitions && typeof definitions === 'object') {
      const definitionKey = $ref.replace('#/definitions/', '');
      const referenced = (definitions as Record<string, unknown>)[definitionKey];
      if (referenced && typeof referenced === 'object') {
        return referenced as Record<string, unknown>;
      }
    }

    return jsonSchema;
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

