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

  it('classifies OpenAI context-limit errors as conversation-level with stable codes', () => {
    const err = new Error('LLM request failed (400): {"error":{"code":"context_length_exceeded"}}');
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_context_limit');
  });

  it('classifies auth errors as conversation-level with stable codes', () => {
    const err = new Error('LLM request failed (401): invalid_api_key');
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_auth');
  });

  it('classifies rate-limit errors as conversation-level with stable codes', () => {
    const err = new Error('LLM request failed (429): rate_limit_exceeded');
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_rate_limit');
  });

  it('classifies service-unavailable errors as conversation-level with stable codes', () => {
    const err = new Error('Anthropic request failed (503): overloaded_error');
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'anthropic' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_service_unavailable');
  });

  it('classifies abort errors as conversation-level timeouts', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_timeout');
  });

  it('classifies fetch network errors as conversation-level network errors', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
    const err = Object.assign(new TypeError('fetch failed'), { cause });
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_network_error');
  });

  it('classifies other 4xx errors as bad requests by default', () => {
    const err = new Error('LLM request failed (400): invalid_request_error');
    const result = classifyError(err, { stage: 'llm_request', llmProvider: 'openai' });
    expect(result.classification).toBe('conversation');
    expect(result.code).toBe('llm_bad_request');
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
