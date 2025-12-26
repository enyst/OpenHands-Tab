import * as vscode from 'vscode';

export async function activate(): Promise<void> {
  const config = vscode.workspace.getConfiguration('openhands');
  console.log('openhands.llm.profileId:', config.get('llm.profileId'));
  console.log('openhands.llm.usageId:', config.get('llm.usageId'));
  console.log('explicit profileId:', config.inspect('llm.profileId')?.workspaceValue ?? config.inspect('llm.profileId')?.globalValue);
}

export function deactivate(): void {}
