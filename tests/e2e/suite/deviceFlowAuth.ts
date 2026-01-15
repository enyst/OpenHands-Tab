import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';
import { startMockOAuthDeviceFlowServer, type DeviceFlowScenarioName } from './helpers/oauthDeviceFlowServer';

type SessionApiKeyStatus = {
  ok?: boolean;
  normalizedServerUrl?: string;
  hasSessionApiKey?: boolean;
};

async function setServerUrl(serverUrl: string): Promise<void> {
  await vscode.commands.executeCommand('openhands._serversSet', { serverUrl, servers: [serverUrl] });
}

async function getSessionStatus(serverUrl: string): Promise<SessionApiKeyStatus> {
  return await vscode.commands.executeCommand<SessionApiKeyStatus>('openhands._e2eGetServerSessionApiKeyStatus', { serverUrl });
}

async function runScenario(params: { scenario: DeviceFlowScenarioName; expectStored: boolean }): Promise<void> {
  const server = await startMockOAuthDeviceFlowServer();
  server.enqueueScenario(params.scenario);

  try {
    await setServerUrl(server.baseUrl);

    await vscode.commands.executeCommand('openhands.cloudLogin');

    if (params.expectStored) {
      await pollUntil(async () => {
        const status = await getSessionStatus(server.baseUrl);
        return Boolean(status?.ok && status?.hasSessionApiKey);
      }, 60000, 250);
      return;
    }

    const status = await getSessionStatus(server.baseUrl);
    if (status?.ok && status?.hasSessionApiKey) {
      throw new Error(`Expected no stored session key for scenario=${params.scenario}, but status=${JSON.stringify(status)}`);
    }
  } finally {
    await server.close();
  }
}

export async function run(): Promise<void> {
  if (process.env.E2E_CLOUD_LOGIN !== '1') {
    throw new Error('Missing required env var: E2E_CLOUD_LOGIN=1');
  }

  await vscode.commands.executeCommand('openhands.open');
  await waitForDiagnostics({
    label: 'chat view ready',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
  });

  await runScenario({ scenario: 'happy', expectStored: true });
  await runScenario({ scenario: 'access_denied', expectStored: false });

  console.log('✓ OAuth device-flow E2E test passed');
}

