import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { classifyHalVoiceDecision } from '../decisionClassifier';

describe('classifyHalVoiceDecision', () => {
  const baseParams = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'gk_test',
    model: 'gemini-2.5-flash',
    mimeType: 'audio/webm',
    audioBase64: 'ZHVtbXk=',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing configuration', async () => {
    expect((await classifyHalVoiceDecision({ ...baseParams, apiKey: '' })).ok).toBe(false);
    expect((await classifyHalVoiceDecision({ ...baseParams, baseUrl: '' })).ok).toBe(false);
    expect((await classifyHalVoiceDecision({ ...baseParams, model: '' })).ok).toBe(false);
    expect((await classifyHalVoiceDecision({ ...baseParams, audioBase64: '' })).ok).toBe(false);
  });

  it('returns error on non-200 responses', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 401 }));

    const res = await classifyHalVoiceDecision(baseParams);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('HTTP 401');
    }
  });

  it('parses decision JSON from candidate text', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"decision":"teleport_remote"}' }],
          },
        },
      ],
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const res = await classifyHalVoiceDecision(baseParams);
    expect(res).toEqual({ ok: true, decision: 'teleport_remote', rawText: '{"decision":"teleport_remote"}' });
  });

  it('returns error when decision JSON is invalid', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: 'not json' }],
          },
        },
      ],
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const res = await classifyHalVoiceDecision(baseParams);
    expect(res.ok).toBe(false);
  });

  it('returns error when decision is not recognized', async () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"decision":"maybe"}' }],
          },
        },
      ],
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const res = await classifyHalVoiceDecision(baseParams);
    expect(res.ok).toBe(false);
  });
});

