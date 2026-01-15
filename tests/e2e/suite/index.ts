import * as vscode from 'vscode';
import { waitForDiagnostics } from './helpers/waitForDiagnostics';

export async function run(): Promise<void> {
  // Route to specific test suite based on TEST_NAME environment variable
  const testName = process.env.TEST_NAME;

  if (testName === 'agentSdkEvents') {
    const { run: runAgentSdkEventsTest } = await import('./agentSdkEvents');
    return runAgentSdkEventsTest();
  }

  if (testName === 'settings') {
    const { run: runSettingsTest } = await import('./settings');
    return runSettingsTest();
  }

  if (testName === 'history') {
    const { run: runHistoryTest } = await import('./history');
    return runHistoryTest();
  }

  if (testName === 'messaging') {
    const { run: runMessagingTest } = await import('./messaging');
    return runMessagingTest();
  }

  if (testName === 'serverSelection') {
    const { run: runServerSelectionTest } = await import('./serverSelection');
    return runServerSelectionTest();
  }

  if (testName === 'confirmation') {
    const { run: runConfirmationTest } = await import('./confirmation');
    return runConfirmationTest();
  }

  if (testName === 'errorHandling') {
    const { run: runErrorHandlingTest } = await import('./errorHandling');
    return runErrorHandlingTest();
  }

  if (testName === 'uiFlows') {
    const { run: runUiFlowsTest } = await import('./uiFlows');
    return runUiFlowsTest();
  }

  if (testName === 'agentServerRemote') {
    const { run: runAgentServerRemoteTest } = await import('./agentServerRemote');
    return runAgentServerRemoteTest();
  }

  if (testName === 'terminalLog') {
    const { run: runTerminalLogTest } = await import('./terminalLog');
    return runTerminalLogTest();
  }

  if (testName === 'llmSwitching') {
    const { run: runLlmSwitchingTest } = await import('./llmSwitching');
    return runLlmSwitchingTest();
  }

  if (testName === 'llmProfiles') {
    const { run: runLlmProfilesTest } = await import('./llmProfiles');
    return runLlmProfilesTest();
  }

  if (testName === 'defaultProfileSelection') {
    const { run: runDefaultProfileSelectionTest } = await import('./defaultProfileSelection');
    return runDefaultProfileSelectionTest();
  }

  if (testName === 'defaultProfilesSeeding') {
    const { run: runDefaultProfilesSeedingTest } = await import('./defaultProfilesSeeding');
    return runDefaultProfilesSeedingTest();
  }

  if (testName === 'oracleUnset') {
    const { run: runOracleUnsetTest } = await import('./oracleUnset');
    return runOracleUnsetTest();
  }

  if (testName === 'oracleConfigured') {
    const { run: runOracleConfiguredTest } = await import('./oracleConfigured');
    return runOracleConfiguredTest();
  }

  if (testName === 'halNegative') {
    const { run: runHalNegativeTest } = await import('./halNegative');
    return runHalNegativeTest();
  }

  if (testName === 'terminalProgress') {
    const { run: runTerminalProgressTest } = await import('./terminalProgress');
    return runTerminalProgressTest();
  }

  if (testName === 'welcome') {
    const { run: runWelcomeTest } = await import('./welcome');
    return runWelcomeTest();
  }

  if (testName === 'gvc') {
    const { run: runGvcTest } = await import('./gvc');
    return runGvcTest();
  }

  if (testName === 'tpq') {
    const { run: runTpqTest } = await import('./tpq');
    return runTpqTest();
  }

  if (testName === 'contextLimitRetry') {
    const { run: runContextLimitRetryTest } = await import('./contextLimitRetry');
    return runContextLimitRetryTest();
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
