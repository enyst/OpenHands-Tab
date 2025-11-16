import * as vscode from 'vscode';

export async function activate(): Promise<void> {
  const config = vscode.workspace.getConfiguration('openhands');
  console.log('openhands.llm.model:', config.get('llm.model'));
  console.log('openhands.llm.usageId:', config.get('llm.usageId'));
  console.log('explicit model:', config.inspect('llm.model')?.workspaceValue ?? config.inspect('llm.model')?.globalValue);
}

export function deactivate(): void {}
