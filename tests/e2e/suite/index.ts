import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Route to specific test suite based on TEST_NAME environment variable
  const testName = process.env.TEST_NAME;

  if (testName === 'agentSdkEvents') {
    const { run: runAgentSdkEventsTest } = await import('./agentSdkEvents');
    return runAgentSdkEventsTest();
  }


  // Default smoke test: open tab and verify it works
  await vscode.commands.executeCommand('openhands.openTab');
  // Wait until panel and webview are ready via diagnostics to avoid flakiness
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.hasPanel && diag?.webviewReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await vscode.commands.executeCommand('openhands.reconnect');
}
