import * as vscode from 'vscode';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';

export async function run(): Promise<void> {
  const suites: Record<string, () => Promise<void>> = {
    agentSdkEvents: async () => { await (await import('./agentSdkEvents')).run(); },
    settings: async () => { await (await import('./settings')).run(); },
    history: async () => { await (await import('./history')).run(); },
    messaging: async () => { await (await import('./messaging')).run(); },
    serverSelection: async () => { await (await import('./serverSelection')).run(); },
    confirmation: async () => { await (await import('./confirmation')).run(); },
    errorHandling: async () => { await (await import('./errorHandling')).run(); },
    uiFlows: async () => { await (await import('./uiFlows')).run(); },
    agentServerRemote: async () => { await (await import('./agentServerRemote')).run(); },
    agentServerRemoteMessaging: async () => { await (await import('./agentServerRemoteMessaging')).run(); },
    agentServerRemoteErrorHandling: async () => { await (await import('./agentServerRemoteErrorHandling')).run(); },
    agentServerRemoteHistory: async () => { await (await import('./agentServerRemoteHistory')).run(); },
    terminalLog: async () => { await (await import('./terminalLog')).run(); },
    llmSwitching: async () => { await (await import('./llmSwitching')).run(); },
    llmProfiles: async () => { await (await import('./llmProfiles')).run(); },
    defaultProfileSelection: async () => { await (await import('./defaultProfileSelection')).run(); },
    defaultProfilesSeeding: async () => { await (await import('./defaultProfilesSeeding')).run(); },
    oracleUnset: async () => { await (await import('./oracleUnset')).run(); },
    oracleConfigured: async () => { await (await import('./oracleConfigured')).run(); },
    halNegative: async () => { await (await import('./halNegative')).run(); },
    terminalProgress: async () => { await (await import('./terminalProgress')).run(); },
    welcome: async () => { await (await import('./welcome')).run(); },
    gvc: async () => { await (await import('./gvc')).run(); },
    tpq: async () => { await (await import('./tpq')).run(); },
    contextLimitRetry: async () => { await (await import('./contextLimitRetry')).run(); },
    deviceFlowAuth: async () => { await (await import('./deviceFlowAuth')).run(); },
    lastUserMessage: async () => { await (await import('./lastUserMessage')).run(); },
  };

  // Route to specific test suite based on TEST_NAME environment variable.
  const testNameRaw = process.env.TEST_NAME;
  const testName = typeof testNameRaw === 'string' ? testNameRaw.trim() : '';

  if (testName) {
    const suite = suites[testName];
    if (!suite) {
      const known = Object.keys(suites).sort().join(', ');
      throw new Error(`Unknown TEST_NAME '${testName}'. Valid values: ${known}`);
    }
    return suite();
  }

  // Default smoke test: open the chat view and verify it works
  await vscode.commands.executeCommand('openhands.open');
  // Wait until view and webview are ready via diagnostics to avoid flakiness
  await waitForDiagnostics({
    label: 'chat view ready',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
  });
  await vscode.commands.executeCommand('openhands.reconnect');
}
