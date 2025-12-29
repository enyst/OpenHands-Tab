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
  close: () => Promise<void>;
  reset: () => void;
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
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: 'text', text }] } }] })}\n\n`);
  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendAnthropicMessagesSse(res: http.ServerResponse, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: message_start\n');
  res.write(`data: ${JSON.stringify({ message: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`);
  res.write('event: content_block_delta\n');
  res.write(`data: ${JSON.stringify({ delta: { type: 'text_delta', text } })}\n\n`);
  res.write('event: message_delta\n');
  res.write(`data: ${JSON.stringify({ delta: { stop_reason: 'end_turn' } })}\n\n`);
  res.end();
}

function sendOpenAiChatCompletionsJson(res: http.ServerResponse, text: string): void {
  const payload = {
    id: 'chatcmpl_mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendAnthropicMessagesJson(res: http.ServerResponse, text: string): void {
  const payload = {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-mock',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
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

export async function startMockLlmServer(): Promise<MockLlmServer> {
  const requests: MockLlmRequest[] = [];
  let port = 0;

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
        requests.splice(0, requests.length);
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

      const wantsStream = Boolean(
        json &&
          typeof json === 'object' &&
          'stream' in (json as Record<string, unknown>) &&
          (json as Record<string, unknown>).stream === true
      );

      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      const prefix = PATH_PREFIXES.find((p) => path.startsWith(p + '/'));
      const normalizedPath = prefix ? path.slice(prefix.length) : path;

      if (normalizedPath === '/chat/completions') {
        if (wantsStream) {
          sendOpenAiChatCompletionsSse(res, 'OK (chat_completions)');
        } else {
          sendOpenAiChatCompletionsJson(res, 'OK (chat_completions)');
        }
        return;
      }

      if (normalizedPath === '/responses') {
        sendOpenAiResponsesJson(res, 'OK (responses)');
        return;
      }

      if (normalizedPath === '/messages') {
        if (wantsStream) {
          sendAnthropicMessagesSse(res, 'OK (anthropic)');
        } else {
          sendAnthropicMessagesJson(res, 'OK (anthropic)');
        }
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
    reset: () => {
      requests.splice(0, requests.length);
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
