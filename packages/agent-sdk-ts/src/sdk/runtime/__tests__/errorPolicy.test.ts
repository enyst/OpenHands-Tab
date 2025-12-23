import { describe, expect, it } from 'vitest';
import { classifyError } from '../errorPolicy';

describe('classifyError', () => {
  it('classifies LLM init errors as conversation-level with codes', () => {
    const err = new Error('Missing API key for LLM provider');
    const result = classifyError(err, { stage: 'llm_init' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('missing_llm_api_key');
    expect(result.message).toContain('Missing API key');
  });

  it('formats tool arg parse errors consistently', () => {
    const err = new Error('Unexpected end of JSON input');
    const result = classifyError(err, { stage: 'tool_args', toolName: 'task_tracker', rawArgs: '{"a":' });
    expect(result.classification).toBe('agent');
    expect(result.message).toContain('Error validating args');
    expect(result.message).toContain('task_tracker');
  });

  it('classifies missing fetch as conversation-level tool execution failure', () => {
    const err = new Error('Global fetch API is unavailable in this runtime');
    const result = classifyError(err, { stage: 'tool_execute', toolName: 'browser' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('missing_fetch_api');
  });

  it('classifies missing terminal shell as conversation-level tool execution failure', () => {
    const err = Object.assign(new Error('spawn /bin/bash ENOENT'), { code: 'ENOENT', path: '/bin/bash' });
    const result = classifyError(err, { stage: 'tool_execute', toolName: 'terminal' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('terminal_shell_missing');
  });
});

