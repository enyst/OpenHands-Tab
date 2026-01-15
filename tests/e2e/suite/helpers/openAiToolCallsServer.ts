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

export type ToolCallArgs = Record<string, unknown>;

export type ToolCallSpec = {
  name: string;
  args: ToolCallArgs;
};

export type OpenAiToolCallsMockRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  json?: unknown;
};

export type OpenAiToolCallsMockServer = {
  baseUrl: string;
  requests: OpenAiToolCallsMockRequest[];
  close: () => Promise<void>;
};

export type OpenAiToolCallsMockServerOptions = {
  toolCalls: ToolCallSpec[];
  includeFinishCall?: boolean;
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

function sendOpenAiToolCallsSse(res: http.ServerResponse, toolCalls: Array<{ id: string; name: string; args: string }>): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: toolCalls.map((call, index) => ({
              index,
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.args },
            })),
          },
        },
      ],
    })}\n\n`,
  );

  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })}\n\n`,
  );

  res.write('data: [DONE]\n\n');
  res.end();
}

export async function startOpenAiToolCallsMockServer(
  options: OpenAiToolCallsMockServerOptions,
): Promise<OpenAiToolCallsMockServer> {
  const requests: OpenAiToolCallsMockRequest[] = [];
  let port = 0;

  const includeFinishCall = options.includeFinishCall ?? true;
  const toolCalls: ToolCallSpec[] = [
    ...options.toolCalls,
    ...(includeFinishCall ? [{ name: 'finish', args: {} }] : []),
  ];

  const server = http.createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const rawUrl = req.url ?? '/';
      const url = new URL(rawUrl, `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
      const path = url.pathname;

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

      if (path === '/v1/chat/completions' || path === '/api/v1/chat/completions') {
        const now = Date.now();
        sendOpenAiToolCallsSse(
          res,
          toolCalls.map((call) => ({
            id: `call_${call.name}_${now}`,
            name: call.name,
            args: JSON.stringify(call.args),
          })),
        );
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
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
