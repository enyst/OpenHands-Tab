import * as http from 'http';
import type { AddressInfo } from 'net';

const REDACTED = '<redacted>';
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
]);

const PATH_PREFIXES = ['/api/v1', '/v1'] as const;

export type MockLlmRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  json?: unknown;
};

export type MockLlmServer = {
  baseUrl: string;
  requests: MockLlmRequest[];
  setScript: (script: MockLlmScript) => void;
  close: () => Promise<void>;
  reset: () => void;
};

export type MockLlmSseEvent = {
  event?: string;
  data: unknown | string;
};

export type MockLlmScriptedResponse =
  | { type: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { type: 'text'; status: number; bodyText: string; headers?: Record<string, string> }
  | { type: 'sse'; status: number; events: MockLlmSseEvent[]; headers?: Record<string, string> };

export type MockLlmScript = {
  method?: string;
  /**
   * Route path to match. This can be the raw request path (eg `/v1/chat/completions`) or the
   * normalized path (eg `/chat/completions`) with `/v1` or `/api/v1` prefixes stripped.
   */
  path: string;
  responses: MockLlmScriptedResponse[];
};

function sanitizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(() => REDACTED);
      } else if (typeof value === 'string') {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = value;
      }
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function sendOpenAiChatCompletionsSse(res: http.ServerResponse, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: 'text', text }] } }] })}\n`);
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })}\n`,
  );
  res.write('data: [DONE]\n');
  res.end();
}

function sendAnthropicMessagesSse(res: http.ServerResponse, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: message_start\n');
  res.write(`data: ${JSON.stringify({ message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n`);
  res.write('event: content_block_delta\n');
  res.write(`data: ${JSON.stringify({ delta: { type: 'text_delta', text } })}\n`);
  res.write('event: message_delta\n');
  res.write(`data: ${JSON.stringify({ delta: { stop_reason: 'end_turn' } })}\n`);
  res.end();
}

function sendOpenAiResponsesJson(res: http.ServerResponse, text: string): void {
  const payload = {
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendGeminiStreamGenerateContentSse(res: http.ServerResponse, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(
    `data: ${JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    })}\n`,
  );
  res.write('data: [DONE]\n');
  res.end();
}

function normalizePath(path: string): string {
  const prefix = PATH_PREFIXES.find((p) => path.startsWith(p + '/')) ?? null;
  return prefix ? path.slice(prefix.length) : path;
}

function sendScriptedResponse(res: http.ServerResponse, response: MockLlmScriptedResponse): void {
  if (response.type === 'json') {
    res.writeHead(response.status, { 'Content-Type': 'application/json', ...(response.headers ?? {}) });
    res.end(JSON.stringify(response.body));
    return;
  }

  if (response.type === 'text') {
    res.writeHead(response.status, { 'Content-Type': 'text/plain', ...(response.headers ?? {}) });
    res.end(response.bodyText);
    return;
  }

  res.writeHead(response.status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...(response.headers ?? {}),
  });

  for (const e of response.events) {
    if (typeof e.event === 'string' && e.event.trim().length > 0) {
      res.write(`event: ${e.event}\n`);
    }
    const dataLine = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
    res.write(`data: ${dataLine}\n\n`);
  }
  res.end();
}

export async function startMockLlmServer(options?: { scripts?: MockLlmScript[] }): Promise<MockLlmServer> {
  const requests: MockLlmRequest[] = [];
  let port = 0;

  const scripts: Array<MockLlmScript & { cursor: number }> = (options?.scripts ?? []).map((s) => ({ ...s, cursor: 0 }));
  const setScript = (script: MockLlmScript): void => {
    scripts.push({ ...script, cursor: 0 });
  };

  const resetState = (): void => {
    requests.splice(0, requests.length);
    for (const script of scripts) {
      script.cursor = 0;
    }
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const rawUrl = req.url ?? '/';
      const url = new URL(rawUrl, `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
      const path = url.pathname;

      if (path === '/__log' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ requests }));
        return;
      }

      if (path === '/__reset' && method === 'POST') {
        resetState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const bodyChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
      await new Promise<void>((resolve) => req.on('end', resolve));
      const bodyText = Buffer.concat(bodyChunks).toString('utf8');
      let json: unknown;
      try {
        json = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
      } catch {
        json = undefined;
      }

      requests.push({
        method,
        path,
        headers: sanitizeHeaders(req.headers),
        bodyText: bodyText.length > 20_000 ? `${bodyText.slice(0, 20_000)}…(truncated)` : bodyText,
        ...(json !== undefined ? { json } : {}),
      });

      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      const normalizedPath = normalizePath(path);

      let scripted: (MockLlmScript & { cursor: number }) | undefined;
      for (let i = scripts.length - 1; i >= 0; i -= 1) {
        const candidate = scripts[i];
        if (candidate.cursor >= candidate.responses.length) continue;
        const expectedMethod = (candidate.method ?? 'POST').toUpperCase();
        const expectedPath = candidate.path;
        if (expectedMethod !== method.toUpperCase()) continue;
        if (expectedPath !== path && expectedPath !== normalizedPath) continue;
        scripted = candidate;
        break;
      }

      if (scripted) {
        const next = scripted.responses[scripted.cursor];
        scripted.cursor += 1;
        sendScriptedResponse(res, next);
        return;
      }

      if (normalizedPath === '/chat/completions') {
        sendOpenAiChatCompletionsSse(res, 'OK (chat_completions)');
        return;
      }

      if (normalizedPath === '/responses') {
        sendOpenAiResponsesJson(res, 'OK (responses)');
        return;
      }

      if (normalizedPath === '/messages') {
        sendAnthropicMessagesSse(res, 'OK (anthropic)');
        return;
      }

      if (
        (path.startsWith('/models/') || path.startsWith('/v1beta/models/')) &&
        path.endsWith(':streamGenerateContent')
      ) {
        sendGeminiStreamGenerateContentSse(res, 'OK (gemini)');
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${path}`);
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Mock server error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock server to a port'));
        return;
      }
      port = (addr as AddressInfo).port;
      resolve();
    });
    server.once('error', reject);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    setScript,
    reset: resetState,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
