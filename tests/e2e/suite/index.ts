import * as vscode from 'vscode';

export async function run(): Promise<void> {
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
