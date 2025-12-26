import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest } from '../../llm';
import type { Message } from '../../types';
import {
  ELLIPSIS,
  redactAndTruncateArgs,
  redactStringHeuristics,
  sanitizeChatRequestForDebug,
  sanitizeMessageForDebug,
  truncateString,
} from '../textSanitizers';

describe('textSanitizers', () => {
  it('truncateString appends ellipsis when over limit', () => {
    expect(truncateString('a'.repeat(2000))).toHaveLength(2000);
    const truncated = truncateString('a'.repeat(2001));
    expect(truncated.endsWith(ELLIPSIS)).toBe(true);
    expect(truncated.length).toBeGreaterThan(2001);
  });

  it('redactStringHeuristics masks bearer tokens and key-like patterns', () => {
    expect(redactStringHeuristics('Authorization: Bearer SECRET')).toBe('Authorization: Bearer ***');
    expect(redactStringHeuristics('Bearer SECRET')).toBe('Bearer ***');
    expect(redactStringHeuristics('sk-abc123SECRETvalue')).toBe('***');
    expect(redactStringHeuristics('ghp_abcdefghijklmnopqrstu')).toBe('***');
    expect(redactStringHeuristics('apiKey=SECRET')).toBe('apiKey: ***');
    // Query-string redaction may normalize `=` into `: ` depending on which regex fires first.
    expect(redactStringHeuristics('?api_key=SECRET&x=1')).toBe('?api_key: ***&x=1');
  });

  it('redactAndTruncateArgs redacts JSON values for common sensitive keys', () => {
    const raw = JSON.stringify({ apiKey: 'NOPE', nested: { token: 'NOPE2' } });
    const output = redactAndTruncateArgs(raw);
    const parsed = JSON.parse(output);
    expect(parsed.apiKey).toBe('***');
    expect(parsed.nested.token).toBe('***');
  });

  it('redactAndTruncateArgs redacts hyphenated API key headers', () => {
    const raw = JSON.stringify({ headers: { 'x-api-key': 'NOPE', Authorization: 'Bearer SECRET' } });
    const output = redactAndTruncateArgs(raw);
    const parsed = JSON.parse(output);
    expect(parsed.headers['x-api-key']).toBe('***');
    expect(parsed.headers.Authorization).toBe('***');
  });

  it('sanitizeMessageForDebug truncates tool text content', () => {
    const message: Message = {
      role: 'tool',
      content: [{ type: 'text', text: 'a'.repeat(250), cache_prompt: false }],
    };
    const sanitized = sanitizeMessageForDebug(message);
    expect(sanitized.role).toBe('tool');
    const text = sanitized.content[0].type === 'text' ? sanitized.content[0].text : '';
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(250);
  });

  it('sanitizeChatRequestForDebug strips system prompt and lists tool names', () => {
    const request: ChatCompletionRequest = {
      systemPrompt: 'REAL_SYSTEM',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello', cache_prompt: false }] },
        { role: 'tool', content: [{ type: 'text', text: 'a'.repeat(250), cache_prompt: false }] },
      ],
      tools: [{ type: 'function', function: { name: 'terminal', description: '', parameters: {} } }],
    };

    const sanitized = sanitizeChatRequestForDebug(request);
    expect(sanitized.systemPrompt).toBe('SYSTEM_PROMPT');
    expect(sanitized.tools).toEqual(['terminal']);
    expect(sanitized.messages).toHaveLength(2);
    const toolText = sanitized.messages[1].content[0].type === 'text' ? sanitized.messages[1].content[0].text : '';
    expect(toolText).toContain('…');
  });
});
