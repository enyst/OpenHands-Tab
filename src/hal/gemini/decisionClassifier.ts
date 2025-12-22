import type { HalDecision } from '../../shared/halTypes';
import { isHalDecision } from '../../shared/halTypes';

type ClassifyParams = {
  baseUrl: string;
  apiKey: string;
  model: string;
  mimeType: string;
  audioBase64: string;
  timeoutMs?: number;
};

type GeminiContentPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiContentPart[];
  };
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
};

export type HalVoiceDecisionResult =
  | { ok: true; decision: HalDecision; rawText: string }
  | { ok: false; error: string; rawText?: string };

const DEFAULT_TIMEOUT_MS = 15000;

export async function classifyHalVoiceDecision(params: ClassifyParams): Promise<HalVoiceDecisionResult> {
  const baseUrl = params.baseUrl.trim().replace(/\/$/, '');
  const apiKey = params.apiKey.trim();
  const model = params.model.trim();
  const mimeType = params.mimeType.trim() || 'audio/webm';
  const audioBase64 = params.audioBase64.trim();
  const timeoutMs = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs) ? params.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!baseUrl) return { ok: false, error: 'Gemini baseUrl is missing.' };
  if (!apiKey) return { ok: false, error: 'Gemini API key is missing.' };
  if (!model) return { ok: false, error: 'Gemini model is missing.' };
  if (!audioBase64) return { ok: false, error: 'No audio provided.' };

  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

  const prompt = [
    'You are a strict classifier for a VS Code UI decision.',
    'Listen to the user audio and output ONLY valid JSON with a single key: "decision".',
    'Valid decisions:',
    '- "approve_local": approve the pending action locally',
    '- "teleport_remote": teleport to the remote runtime',
    '- "reject": reject the pending action',
    '',
    'Output JSON only. Example: {"decision":"approve_local"}',
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: audioBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      const suffix = text.trim() ? ` (${text.trim().slice(0, 500)})` : '';
      return { ok: false, error: `Gemini request failed: HTTP ${res.status}${suffix}` };
    }

    let parsed: GeminiGenerateContentResponse;
    try {
      parsed = JSON.parse(text) as GeminiGenerateContentResponse;
    } catch {
      return { ok: false, error: 'Gemini returned non-JSON response.', rawText: text };
    }

    const rawText = (parsed.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (!rawText) return { ok: false, error: 'Gemini returned an empty response.' };

    let decisionValue: unknown;
    try {
      const obj = JSON.parse(rawText) as { decision?: unknown };
      decisionValue = obj.decision;
    } catch {
      return { ok: false, error: 'Gemini returned non-JSON decision.', rawText };
    }

    if (!isHalDecision(decisionValue)) {
      return { ok: false, error: 'Gemini returned an invalid decision.', rawText };
    }

    return { ok: true, decision: decisionValue, rawText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Gemini request failed: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

