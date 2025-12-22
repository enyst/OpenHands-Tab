import { normalizeTtsText } from './normalize';

export type ElevenLabsErrorKind = 'config' | 'auth' | 'transient' | 'http' | 'unknown';

export class ElevenLabsError extends Error {
  readonly kind: ElevenLabsErrorKind;
  readonly status?: number;

  constructor(message: string, options: { kind: ElevenLabsErrorKind; status?: number }) {
    super(message);
    this.name = 'ElevenLabsError';
    this.kind = options.kind;
    this.status = options.status;
  }
}

export type ElevenLabsTtsParams = {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
  maxRetries?: number;
};

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';

const isRetriableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

const isNonRetriableClientError = (status: number): boolean =>
  status === 400 || status === 401 || status === 403 || status === 404 || status === 422;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function readLimitedText(res: Response, maxChars: number): Promise<string | undefined> {
  try {
    const text = await res.text();
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
  } catch {
    return undefined;
  }
}

export async function fetchElevenLabsTts(params: ElevenLabsTtsParams): Promise<Uint8Array> {
  const apiKey = params.apiKey.trim();
  const voiceId = params.voiceId.trim();
  if (!apiKey) throw new ElevenLabsError('Missing ElevenLabs API key', { kind: 'config' });
  if (!voiceId) throw new ElevenLabsError('Missing ElevenLabs voice id', { kind: 'config' });

  const baseUrl = (params.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = params.fetchImpl ?? fetch;
  const sleepImpl = params.sleepImpl ?? sleep;
  const randomImpl = params.randomImpl ?? Math.random;
  const maxRetries = typeof params.maxRetries === 'number' ? Math.max(0, Math.trunc(params.maxRetries)) : 2;

  const text = normalizeTtsText(params.text);
  if (!text) throw new ElevenLabsError('Missing TTS text', { kind: 'config' });

  const url = `${baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const body = JSON.stringify({
    text,
    model_id: params.modelId ?? undefined,
  });

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
    'xi-api-key': apiKey,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const isLastAttempt = attempt === maxRetries;
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body });
      if (!res.ok) {
        const status = res.status;
        const detail = await readLimitedText(res, 200);

        if (isNonRetriableClientError(status) && status !== 429) {
          const kind: ElevenLabsErrorKind = status === 401 || status === 403 ? 'auth' : 'config';
          throw new ElevenLabsError(`ElevenLabs TTS failed (${status})${detail ? `: ${detail}` : ''}`, { kind, status });
        }

        if (!isLastAttempt && isRetriableStatus(status)) {
          const baseDelay = attempt === 0 ? 250 : 500;
          const jitter = Math.floor(randomImpl() * baseDelay);
          await sleepImpl(baseDelay + jitter);
          continue;
        }

        const kind: ElevenLabsErrorKind = isRetriableStatus(status) ? 'transient' : 'http';
        throw new ElevenLabsError(`ElevenLabs TTS failed (${status})${detail ? `: ${detail}` : ''}`, { kind, status });
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0) {
        throw new ElevenLabsError('ElevenLabs returned empty audio', { kind: 'unknown' });
      }
      return buf;
    } catch (err) {
      if (!isLastAttempt) {
        const kind = err instanceof ElevenLabsError ? err.kind : 'unknown';
        if (kind === 'transient' || kind === 'unknown') {
          const baseDelay = attempt === 0 ? 250 : 500;
          const jitter = Math.floor(randomImpl() * baseDelay);
          await sleepImpl(baseDelay + jitter);
          continue;
        }
      }
      throw err;
    }
  }

  throw new ElevenLabsError('ElevenLabs TTS failed after retries', { kind: 'unknown' });
}

