import * as vscode from 'vscode';

export async function run(): Promise<void> {
  // Route to specific test suite based on TEST_NAME environment variable
  const testName = process.env.TEST_NAME;

  if (testName === 'agentSdkEvents') {
    const { run: runAgentSdkEventsTest } = await import('./agentSdkEvents');
    return runAgentSdkEventsTest();
  }

  if (testName === 'bashEvents') {
    const { run: runBashEventsTest } = await import('./bashEvents');
    return runBashEventsTest();
  }

  // Default smoke test: open tab and verify it works
  await vscode.commands.executeCommand('openhands.openTab');
  // Wait until panel is reported via diagnostics to avoid flakiness
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    if (diag?.hasPanel) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await vscode.commands.executeCommand('openhands.reconnect');
}
