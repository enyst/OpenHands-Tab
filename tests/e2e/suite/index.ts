import * as vscode from 'vscode';

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

  // Default smoke test: open the chat view and verify it works
  await vscode.commands.executeCommand('openhands.open');
  // Wait until view and webview are ready via diagnostics to avoid flakiness
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.chat?.hasView && diag?.chat?.webviewReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await vscode.commands.executeCommand('openhands.reconnect');
}
