import * as http from 'http';
import * as net from 'net';

const REDACTED = '<redacted>';
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
]);

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

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Failed to allocate free port')));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

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

export async function startMockLlmServer(): Promise<MockLlmServer> {
  const requests: MockLlmRequest[] = [];
  const port = await getFreePort();

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

      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method not allowed');
        return;
      }

      if (path === '/chat/completions') {
        sendOpenAiChatCompletionsSse(res, 'OK (chat_completions)');
        return;
      }

      if (path === '/responses') {
        sendOpenAiResponsesJson(res, 'OK (responses)');
        return;
      }

      if (path === '/messages') {
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

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

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
