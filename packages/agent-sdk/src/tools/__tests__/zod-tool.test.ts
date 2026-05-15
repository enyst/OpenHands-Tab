import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ZodTool, booleanWithDefault } from '../zod-tool';
import type { ToolContext } from '../types';

// Create a concrete implementation of ZodTool for testing
class TestTool extends ZodTool<{ message: string; count?: number }, string> {
  readonly name = 'test_tool';
  readonly description = 'A test tool for unit tests';
  readonly schema = z.object({
    message: z.string(),
    count: z.number().optional(),
  });

  async execute(args: { message: string; count?: number }, context: ToolContext): Promise<string> {
    const count = args.count ?? 1;
    return args.message.repeat(count);
  }
}

// Tool with nested schema
class NestedSchemaTool extends ZodTool<{ config: { enabled: boolean; options: string[] } }, void> {
  readonly name = 'nested_tool';
  readonly description = 'A tool with nested schema';
  readonly schema = z.object({
    config: z.object({
      enabled: z.boolean(),
      options: z.array(z.string()),
    }),
  });

  async execute(args: { config: { enabled: boolean; options: string[] } }, context: ToolContext): Promise<void> {
    // Do nothing
  }
}

// Tool with custom parameter schema
class CustomParametersTool extends ZodTool<{ value: string }, string> {
  readonly name = 'custom_params_tool';
  readonly description = 'A tool with custom parameters';
  readonly schema = z.object({ value: z.string() });
  protected override readonly parameterSchema = {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'Custom description' },
    },
  };

  async execute(args: { value: string }, context: ToolContext): Promise<string> {
    return args.value;
  }
}

describe('ZodTool', () => {
  describe('validate', () => {
    it('validates correct input', () => {
      const tool = new TestTool();
      const result = tool.validate({ message: 'hello', count: 3 });
      expect(result.message).toBe('hello');
      expect(result.count).toBe(3);
    });

    it('validates input with optional fields missing', () => {
      const tool = new TestTool();
      const result = tool.validate({ message: 'hello' });
      expect(result.message).toBe('hello');
      expect(result.count).toBeUndefined();
    });

    it('throws for invalid input', () => {
      const tool = new TestTool();
      expect(() => tool.validate({ message: 123 })).toThrow();
    });

    it('throws for missing required fields', () => {
      const tool = new TestTool();
      expect(() => tool.validate({})).toThrow();
    });

    it('validates nested schema', () => {
      const tool = new NestedSchemaTool();
      const result = tool.validate({
        config: {
          enabled: true,
          options: ['a', 'b'],
        },
      });
      expect(result.config.enabled).toBe(true);
      expect(result.config.options).toEqual(['a', 'b']);
    });
  });

  describe('execute', () => {
    const mockContext: ToolContext = {
      workspaceRoot: '/test',
    };

    it('executes tool with valid args', async () => {
      const tool = new TestTool();
      const result = await tool.execute({ message: 'hi' }, mockContext);
      expect(result).toBe('hi');
    });

    it('executes tool with optional args', async () => {
      const tool = new TestTool();
      const result = await tool.execute({ message: 'x', count: 5 }, mockContext);
      expect(result).toBe('xxxxx');
    });
  });

  describe('parameters', () => {
    it('generates JSON schema from Zod schema', () => {
      const tool = new TestTool();
      const params = tool.parameters;

      expect(params.type).toBe('object');
      expect(params.properties).toBeDefined();
      expect((params.properties as Record<string, unknown>).message).toBeDefined();
    });

    it('uses custom parameter schema when provided', () => {
      const tool = new CustomParametersTool();
      const params = tool.parameters;

      expect(params.type).toBe('object');
      expect((params.properties as Record<string, { description?: string }>).value.description).toBe('Custom description');
    });

    it('handles nested schemas', () => {
      const tool = new NestedSchemaTool();
      const params = tool.parameters;

      expect(params.type).toBe('object');
      expect((params.properties as Record<string, unknown>).config).toBeDefined();
    });
  });

  describe('getToolDefinition', () => {
    it('returns LLM tool definition', () => {
      const tool = new TestTool();
      const def = tool.getToolDefinition();

      expect(def.type).toBe('function');
      expect(def.function.name).toBe('test_tool');
      expect(def.function.description).toBe('A test tool for unit tests');
      expect(def.function.parameters).toBeDefined();
    });

    it('includes parameters from schema', () => {
      const tool = new TestTool();
      const def = tool.getToolDefinition();

      expect(def.function.parameters.type).toBe('object');
      expect(def.function.parameters.properties).toBeDefined();
    });
  });
});

describe('booleanWithDefault', () => {
  it('creates schema with default true', () => {
    const schema = booleanWithDefault(true);
    expect(schema.parse(undefined)).toBe(true);
    expect(schema.parse(false)).toBe(false);
    expect(schema.parse(true)).toBe(true);
  });

  it('creates schema with default false', () => {
    const schema = booleanWithDefault(false);
    expect(schema.parse(undefined)).toBe(false);
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it('throws for non-boolean values', () => {
    const schema = booleanWithDefault(true);
    expect(() => schema.parse('true')).toThrow();
    expect(() => schema.parse(1)).toThrow();
    expect(() => schema.parse(null)).toThrow();
  });
});
