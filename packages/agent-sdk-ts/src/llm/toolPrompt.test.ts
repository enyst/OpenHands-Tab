import { describe, expect, it } from 'vitest';

import type { LLMToolDefinition } from './types';
import { buildToolsPrompt, convertToolsToDescription } from './toolPrompt';

describe('toolPrompt', () => {
  const tools: LLMToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'terminal',
        description: 'Execute bash commands',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run' },
            timeout: { type: 'number' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'task_tracker',
      },
    },
  ];

  it('matches the Python tool description format', () => {
    const description = convertToolsToDescription(tools);
    const expected = [
      '---- BEGIN FUNCTION #1: terminal ----',
      'Description: Execute bash commands',
      'Parameters:',
      '  (1) command (string, required): Command to run',
      '  (2) timeout (number, optional): No description provided',
      '---- END FUNCTION #1 ----',
      '',
      '---- BEGIN FUNCTION #2: task_tracker ----',
      'No parameters are required for this function.',
      '---- END FUNCTION #2 ----',
      '',
    ].join('\n');

    expect(description).toEqual(expected);
  });

  it('embeds the tool description in the system suffix template', () => {
    const prompt = buildToolsPrompt(tools);
    expect(prompt).toContain('You have access to the following functions:');
    expect(prompt).toContain('<IMPORTANT>');
    expect(prompt).toContain('Function calls MUST follow the specified format');
    expect(prompt).toContain(convertToolsToDescription(tools));
  });
});

