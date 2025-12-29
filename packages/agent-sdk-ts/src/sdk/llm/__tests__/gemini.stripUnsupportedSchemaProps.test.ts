import { describe, expect, it } from 'vitest';
import { stripUnsupportedSchemaProps } from '../gemini';

describe('stripUnsupportedSchemaProps', () => {
  it('returns primitives unchanged', () => {
    expect(stripUnsupportedSchemaProps(null)).toBe(null);
    expect(stripUnsupportedSchemaProps(undefined)).toBe(undefined);
    expect(stripUnsupportedSchemaProps('string')).toBe('string');
    expect(stripUnsupportedSchemaProps(123)).toBe(123);
    expect(stripUnsupportedSchemaProps(true)).toBe(true);
  });

  it('strips additionalProperties from top-level object', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
    const result = stripUnsupportedSchemaProps(schema);
    expect(result).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });

  it('strips additionalProperties from nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { id: { type: 'number' } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };
    const result = stripUnsupportedSchemaProps(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { id: { type: 'number' } },
        },
      },
    });
  });

  it('strips additionalProperties from array items', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { value: { type: 'string' } },
        additionalProperties: false,
      },
    };
    const result = stripUnsupportedSchemaProps(schema);
    expect(result).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { value: { type: 'string' } },
      },
    });
  });

  it('handles arrays at top level', () => {
    const schema = [
      { type: 'string', additionalProperties: false },
      { type: 'number' },
    ];
    const result = stripUnsupportedSchemaProps(schema);
    expect(result).toEqual([
      { type: 'string' },
      { type: 'number' },
    ]);
  });

  it('preserves all other schema properties', () => {
    const schema = {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create'],
          description: 'The command to run',
        },
        path: {
          type: 'string',
          description: 'Path to file',
        },
      },
      required: ['command', 'path'],
      additionalProperties: false,
    };
    const result = stripUnsupportedSchemaProps(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create'],
          description: 'The command to run',
        },
        path: {
          type: 'string',
          description: 'Path to file',
        },
      },
      required: ['command', 'path'],
    });
  });

  it('handles deeply nested structures from zod-to-json-schema', () => {
    // Simulate a realistic schema from zod-to-json-schema
    const schema = {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['read', 'write'] },
            params: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['file'],
              additionalProperties: false,
            },
          },
          required: ['type', 'params'],
          additionalProperties: false,
        },
      },
      required: ['action'],
      additionalProperties: false,
    };

    const result = stripUnsupportedSchemaProps(schema) as Record<string, unknown>;
    expect(result).toEqual({
      type: 'object',
      properties: {
        action: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['read', 'write'] },
            params: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['file']
            }
          },
          required: ['type', 'params']
        }
      },
      required: ['action']
    });
  });
});
