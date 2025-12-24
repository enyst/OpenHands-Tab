import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { BashEvent } from '@openhands/agent-sdk-ts';

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  // Force local mode to ensure terminal log is available
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('openhands.reconnect');

  // Inject a Bash command + many CR progress updates + exit. This bypasses needing an actual shell.
  const cmd: BashEvent = { type: 'BashCommand', command: 'progress_task', command_id: 'e2e_cmd_1', cwd: process.cwd() } as any;
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', cmd);

  const makeOutput = (i: number): BashEvent => ({ type: 'BashOutput', command_id: 'e2e_cmd_1', stdout: `progress ${i}%\r` } as any);
  for (let i = 1; i <= 10; i++) {
    await vscode.commands.executeCommand('openhands._injectTerminalEvent', makeOutput(i));
  }
  // Final newline-terminated line to flush progress
  const final: BashEvent = { type: 'BashOutput', command_id: 'e2e_cmd_1', stdout: 'done\n' } as any;
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', final);

  // Exit event (should render only one [Process exited] footer)
  const exit: BashEvent = { type: 'BashExit', command_id: 'e2e_cmd_1', exit_code: 0 } as any;
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', exit);

  // Verify diagnostics reflect terminal received events and that terminal exists
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diag?.terminal?.hasTerminal) throw new Error('Expected OpenHands terminal to be created');
  if (typeof diag?.terminal?.received !== 'number' || diag.terminal.received < 3) {
    throw new Error(`Expected some terminal events, got: ${JSON.stringify(diag?.terminal)}`);
  }
}
