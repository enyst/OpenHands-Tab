import * as vscode from 'vscode';

export async function run() {
  await vscode.commands.executeCommand('openhands.openTab');
  await new Promise((r) => setTimeout(r, 500));
  await vscode.commands.executeCommand('openhands.reconnect');
}
