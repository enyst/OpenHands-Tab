import * as http from 'http';
import type { AddressInfo } from 'net';
import { randomBytes } from 'crypto';

export type OAuthDeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
};

export type OAuthDeviceTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type DeviceFlowScenarioName = 'happy' | 'access_denied' | 'expired_token' | 'slow_down_then_success';

export type MockOAuthDeviceFlowServer = {
  baseUrl: string;
  enqueueScenario: (name: DeviceFlowScenarioName) => void;
  close: () => Promise<void>;
  reset: () => void;
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBodyText(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function newCode(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function buildScenario(name: DeviceFlowScenarioName): OAuthDeviceTokenResponse[] {
  if (name === 'happy') {
    return [{ error: 'authorization_pending' }, { access_token: newCode('tok') }];
  }
  if (name === 'access_denied') {
    return [{ error: 'authorization_pending' }, { error: 'access_denied' }];
  }
  if (name === 'expired_token') {
    return [{ error: 'authorization_pending' }, { error: 'expired_token' }];
  }
  // slow_down_then_success
  return [{ error: 'slow_down' }, { error: 'authorization_pending' }, { access_token: newCode('tok') }];
}

export async function startMockOAuthDeviceFlowServer(): Promise<MockOAuthDeviceFlowServer> {
  const deviceStates = new Map<string, { cursor: number; responses: OAuthDeviceTokenResponse[] }>();
  const scenarioQueue: DeviceFlowScenarioName[] = [];

  let port = 0;

  const reset = (): void => {
    deviceStates.clear();
    scenarioQueue.splice(0, scenarioQueue.length);
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const rawUrl = req.url ?? '/';
        const url = new URL(rawUrl, `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
        const path = url.pathname;

        if (method !== 'POST') {
          json(res, 405, { error: 'method_not_allowed' });
          return;
        }

        if (path === '/oauth/device/authorize') {
          const deviceCode = newCode('device');
          const userCode = newCode('user');
          const scenario = scenarioQueue.shift() ?? 'happy';
          deviceStates.set(deviceCode, { cursor: 0, responses: buildScenario(scenario) });

          const body: OAuthDeviceAuthorizationResponse = {
            device_code: deviceCode,
            user_code: userCode,
            // Use an unknown scheme so `vscode.env.openExternal()` returns false in headless-ish environments.
            verification_uri: 'openhands+e2e://device-flow',
            interval: 1,
          };

          json(res, 200, body);
          return;
        }

        if (path === '/oauth/device/token') {
          const text = await readBodyText(req);
          const parsed = new URLSearchParams(text);
          const deviceCode = (parsed.get('device_code') ?? '').trim();
          const state = deviceCode ? deviceStates.get(deviceCode) : undefined;
          if (!state) {
            json(res, 200, { error: 'invalid_request', error_description: 'Unknown device_code' } satisfies OAuthDeviceTokenResponse);
            return;
          }

          const response =
            state.cursor < state.responses.length ? state.responses[state.cursor] : state.responses[state.responses.length - 1];
          state.cursor += 1;
          json(res, 200, response);
          return;
        }

        json(res, 404, { error: 'not_found' });
      } catch (err) {
        json(res, 500, { error: 'server_error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    enqueueScenario: (name) => {
      scenarioQueue.push(name);
    },
    reset,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

