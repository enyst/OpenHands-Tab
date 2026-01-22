import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';
import { startMockOAuthDeviceFlowServer, type DeviceFlowScenarioName } from './helpers/oauthDeviceFlowServer';

type CloudLoginStatus = {
  ok?: boolean;
  normalizedServerUrl?: string;
  hasCloudApiKey?: boolean;
  hasRuntimeSessionApiKey?: boolean;
};

async function setServerUrl(serverUrl: string): Promise<void> {
  await vscode.commands.executeCommand('openhands._serversSet', { serverUrl, servers: [serverUrl] });
}

async function getCloudLoginStatus(serverUrl: string): Promise<CloudLoginStatus> {
  // Command name is legacy; the response shape is now cloud/runtime-specific.
  return await vscode.commands.executeCommand<CloudLoginStatus>('openhands._e2eGetServerSessionApiKeyStatus', { serverUrl });
}

async function runScenario(params: { scenario: DeviceFlowScenarioName; expectStored: boolean }): Promise<{ serverUrl: string }> {
  const server = await startMockOAuthDeviceFlowServer();
  server.enqueueScenario(params.scenario);
  const serverUrl = server.baseUrl;

  try {
    await setServerUrl(serverUrl);

    await vscode.commands.executeCommand('openhands.cloudLogin');

    if (params.expectStored) {
      await pollUntil(async () => {
        const status = await getCloudLoginStatus(serverUrl);
        return Boolean(status?.ok && status?.hasCloudApiKey);
      }, 60000, 250);
      return { serverUrl };
    }

    const status = await getCloudLoginStatus(serverUrl);
    if (status?.ok && status?.hasCloudApiKey) {
      throw new Error(`Expected no stored cloud token for scenario=${params.scenario}, but status=${JSON.stringify(status)}`);
    }
    if (status?.ok && status?.hasRuntimeSessionApiKey) {
      throw new Error(`Expected runtime session key to remain unset for scenario=${params.scenario}, but status=${JSON.stringify(status)}`);
    }

    return { serverUrl };
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

  const happy = await runScenario({ scenario: 'happy', expectStored: true });

  await vscode.commands.executeCommand('openhands.cloudLogout');
  await pollUntil(async () => {
    const status = await getCloudLoginStatus(happy.serverUrl);
    return Boolean(status?.ok && !status?.hasCloudApiKey && !status?.hasRuntimeSessionApiKey);
  }, 60000, 250);

  await runScenario({ scenario: 'access_denied', expectStored: false });
  await runScenario({ scenario: 'expired_token', expectStored: false });
  await runScenario({ scenario: 'slow_down_then_success', expectStored: true });

  console.log('✓ OAuth device-flow E2E test passed');
}
