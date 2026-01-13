import * as http from 'http';
import type { AddressInfo } from 'net';
import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';

const REDACTED = '<redacted>';
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
]);

type MockRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  json?: unknown;
};

type MockServer = {
  baseUrl: string;
  requests: MockRequest[];
  close: () => Promise<void>;
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
    })}\n`,
  );

  res.write(
    `data: ${JSON.stringify({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })}\n`,
  );

  res.write('data: [DONE]\n');
  res.end();
}

async function startOracleUnsetMockServer(): Promise<MockServer> {
  const requests: MockRequest[] = [];
  let port = 0;

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
        sendOpenAiToolCallsSse(res, [
          {
            id: `call_ask_${now}`,
            name: 'ask_oracle',
            args: JSON.stringify({
              question: 'Should we proceed?',
              context: 'E2E: oracle unset test',
            }),
          },
          {
            id: `call_finish_${now}`,
            name: 'finish',
            args: JSON.stringify({}),
          },
        ]);
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

type WebviewActionResult = { sent?: boolean };

type LastObservationInfo = {
  seq?: number;
  tool_name?: unknown;
  tool_call_id?: unknown;
  observationText?: unknown;
} | null;

export async function run(): Promise<void> {
  const mock = await startOracleUnsetMockServer();

  try {
    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 15000);

    const cfg = vscode.workspace.getConfiguration();
    const update = async (key: string, value: unknown): Promise<void> => {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    };

    // Force local mode + keep runs small + ensure oracle is unset.
    await update('openhands.serverUrl', '');
    await update('openhands.conversation.maxIterations', 5);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);
    await update('openhands.agent.summarizeToolCalls', false);
    await update('openhands.oracle.profileId', '');

    const v1BaseUrl = `${mock.baseUrl}/v1`;
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-oracle-unset-main',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._setProfileApiKey', {
      profileId: 'e2e-oracle-unset-main',
      apiKey: 'e2e-oracle-unset-key',
    });

    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-oracle-unset-main' });
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    const setTools = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'setEnabledTools',
      payload: { toolIds: ['ask_oracle'] },
    });
    if (!setTools?.sent) {
      throw new Error(`setEnabledTools action was not sent: ${JSON.stringify(setTools)}`);
    }

    const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'sendMessage',
      payload: { text: 'E2E oracleUnset: trigger tool call' },
    });
    if (!send?.sent) {
      throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
    }

    await pollUntil(async () => {
      const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
        tool_name: 'ask_oracle',
      });
      const text = typeof info?.observationText === 'string' ? info.observationText : '';
      return text.includes('openhands.oracle.profileId');
    }, 15000);

    const info = await vscode.commands.executeCommand<LastObservationInfo>('openhands._queryLastObservation', {
      tool_name: 'ask_oracle',
    });
    const text = typeof info?.observationText === 'string' ? info.observationText : '';
    if (!text.includes('openhands.oracle.profileId')) {
      throw new Error(`Expected ask_oracle observation to mention openhands.oracle.profileId; got: ${JSON.stringify(info)}`);
    }

    if (mock.requests.length !== 1) {
      const recent = mock.requests.map((r) => `${r.method} ${r.path}`).join(', ');
      throw new Error(`Expected exactly 1 LLM request; got ${mock.requests.length}: ${recent}`);
    }
    if (mock.requests[0]?.path !== '/v1/chat/completions') {
      throw new Error(`Expected request path /v1/chat/completions; got ${mock.requests[0]?.path}`);
    }
  } finally {
    await mock.close();
  }
}

