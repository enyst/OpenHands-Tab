import { describe, expect, it } from 'vitest';
import type { LLMClient } from '../types';
import { createFallbackLlmClient, createRouterLlmClient, shouldFallbackOnLlmErrorCodes } from '../router';

describe('LLM router helpers', () => {
  it('routes based on the selected key', async () => {
    const events: string[] = [];
    const mkClient = (key: string): LLMClient => ({
      async *streamChat() {
        events.push(key);
        yield { type: 'text', text: key };
        yield { type: 'finish' };
      },
    });

    const client = createRouterLlmClient({
      clients: { a: mkClient('a'), b: mkClient('b') },
      router: { select: ({ hasImages }) => (hasImages ? 'b' : 'a') },
    });

    const out: string[] = [];
    for await (const chunk of client.streamChat({
      systemPrompt: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      if (chunk.type === 'text') out.push(chunk.text);
    }

    expect(events).toEqual(['a']);
    expect(out.join('')).toBe('a');
  });

  it('falls back when shouldFallback returns true', async () => {
    const primary: LLMClient = {
      async *streamChat(request) {
        if (request.messages.length < 0) {
          yield { type: 'finish' };
        }
        throw new Error('LLM request failed (503): overloaded');
      },
    };
    const fallback: LLMClient = {
      async *streamChat() {
        yield { type: 'text', text: 'ok' };
        yield { type: 'finish' };
      },
    };

    const client = createFallbackLlmClient({
      primary,
      fallback,
      shouldFallback: shouldFallbackOnLlmErrorCodes({
        provider: 'anthropic',
        codes: ['llm_service_unavailable'],
      }),
    });

    const out: string[] = [];
    for await (const chunk of client.streamChat({
      systemPrompt: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      if (chunk.type === 'text') out.push(chunk.text);
    }

    expect(out.join('')).toBe('ok');
  });

  it('does not fall back after yielding any chunks', async () => {
    const primary: LLMClient = {
      async *streamChat() {
        yield { type: 'text', text: 'partial' };
        throw new Error('LLM request failed (503): overloaded');
      },
    };
    const fallback: LLMClient = {
      async *streamChat() {
        yield { type: 'text', text: 'ok' };
        yield { type: 'finish' };
      },
    };

    const client = createFallbackLlmClient({
      primary,
      fallback,
      shouldFallback: shouldFallbackOnLlmErrorCodes({
        provider: 'anthropic',
        codes: ['llm_service_unavailable'],
      }),
    });

    const out: string[] = [];
    const iterate = async (): Promise<void> => {
      for await (const chunk of client.streamChat({
        systemPrompt: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        if (chunk.type === 'text') out.push(chunk.text);
      }
    };

    await expect(iterate()).rejects.toThrow(/503/);
    expect(out.join('')).toBe('partial');
  });

  it('rethrows when shouldFallback returns false', async () => {
    const primary: LLMClient = {
      async *streamChat() {
        // Yield once to satisfy lint rules, then throw to test rethrow behavior.
        yield { type: 'finish' };
        throw new Error('LLM request failed (401): invalid_api_key');
      },
    };
    const fallback: LLMClient = {
      async *streamChat() {
        yield { type: 'text', text: 'ok' };
        yield { type: 'finish' };
      },
    };

    const client = createFallbackLlmClient({
      primary,
      fallback,
      shouldFallback: shouldFallbackOnLlmErrorCodes({
        provider: 'openai',
        codes: ['llm_rate_limit'],
      }),
    });

    const iterate = async (): Promise<void> => {
      for await (const chunk of client.streamChat({
        systemPrompt: '',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        void chunk;
      }
    };

    await expect(iterate()).rejects.toThrow(/401/);
  });
});
