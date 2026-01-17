import * as vscode from 'vscode';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';

export async function run(): Promise<void> {
  const suites: Record<string, () => Promise<void>> = {
    agentSdkEvents: async () => (await import('./agentSdkEvents')).run(),
    settings: async () => (await import('./settings')).run(),
    history: async () => (await import('./history')).run(),
    messaging: async () => (await import('./messaging')).run(),
    serverSelection: async () => (await import('./serverSelection')).run(),
    confirmation: async () => (await import('./confirmation')).run(),
    errorHandling: async () => (await import('./errorHandling')).run(),
    uiFlows: async () => (await import('./uiFlows')).run(),
    agentServerRemote: async () => (await import('./agentServerRemote')).run(),
    terminalLog: async () => (await import('./terminalLog')).run(),
    llmSwitching: async () => (await import('./llmSwitching')).run(),
    llmProfiles: async () => (await import('./llmProfiles')).run(),
    defaultProfileSelection: async () => (await import('./defaultProfileSelection')).run(),
    defaultProfilesSeeding: async () => (await import('./defaultProfilesSeeding')).run(),
    oracleUnset: async () => (await import('./oracleUnset')).run(),
    oracleConfigured: async () => (await import('./oracleConfigured')).run(),
    halNegative: async () => (await import('./halNegative')).run(),
    terminalProgress: async () => (await import('./terminalProgress')).run(),
    welcome: async () => (await import('./welcome')).run(),
    gvc: async () => (await import('./gvc')).run(),
    tpq: async () => (await import('./tpq')).run(),
    contextLimitRetry: async () => (await import('./contextLimitRetry')).run(),
    deviceFlowAuth: async () => (await import('./deviceFlowAuth')).run(),
    lastUserMessage: async () => (await import('./lastUserMessage')).run(),
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
