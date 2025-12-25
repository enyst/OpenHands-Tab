import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest } from '../types';
import { estimateRequestTokens, isContextLimitError, wouldExceedMaxInputTokens } from '../contextLimit';

describe('isContextLimitError', () => {
  it('detects OpenAI context-length errors', () => {
    expect(isContextLimitError('openai', new Error('LLM request failed (400): {"error":{"code":"context_length_exceeded"}}'))).toBe(true);
    expect(
      isContextLimitError(
        'openai',
        new Error("LLM request failed (400): This model's maximum context length is 8192 tokens, however you requested 9000 tokens."),
      ),
    ).toBe(true);
    expect(isContextLimitError('openai', new Error('LLM request failed (401): invalid_api_key'))).toBe(false);
  });

  it('detects Anthropic prompt-too-long errors', () => {
    expect(
      isContextLimitError(
        'anthropic',
        new Error('Anthropic request failed (400): {"type":"error","error":{"message":"prompt is too long"}}'),
      ),
    ).toBe(true);
  });

  it('detects Gemini token-limit errors', () => {
    expect(
      isContextLimitError(
        'gemini',
        new Error('LLM request failed (HTTP 400): {"error":{"message":"The input token count is 200000, which exceeds the maximum number of tokens"}}'),
      ),
    ).toBe(true);
  });
});

describe('estimateRequestTokens / wouldExceedMaxInputTokens', () => {
  const baseRequest: ChatCompletionRequest = {
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
  };

  it('estimates prompt tokens using a conservative heuristic', () => {
    const request: ChatCompletionRequest = {
      ...baseRequest,
      systemPrompt: 'x'.repeat(4000),
    };
    expect(estimateRequestTokens(request)).toBeGreaterThanOrEqual(1000);
  });

  it('returns true when estimated tokens exceed maxInputTokens', () => {
    const request: ChatCompletionRequest = {
      ...baseRequest,
      systemPrompt: 'x'.repeat(4000),
    };
    expect(wouldExceedMaxInputTokens({ request, maxInputTokens: 900 })).toBe(true);
    expect(wouldExceedMaxInputTokens({ request, maxInputTokens: 2000 })).toBe(false);
  });

  it('includes tool definitions in the estimate (best-effort)', () => {
    const request: ChatCompletionRequest = {
      systemPrompt: 'Short.',
      messages: [],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'x'.repeat(4000),
            parameters: { type: 'object', properties: { a: { type: 'string' } } },
          },
        },
      ],
    };

    expect(wouldExceedMaxInputTokens({ request, maxInputTokens: 200 })).toBe(true);
  });
});

