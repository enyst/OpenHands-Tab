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
  const cmdId = 'e2e_cmd_1';
  let order = 0;
  const nextBase = (type: BashEvent['type']) => ({
    id: `e2e-${cmdId}-${order}`,
    type,
    timestamp: new Date().toISOString(),
    command_id: cmdId,
    order: order++,
  });

  const cmd: BashEvent = { ...nextBase('BashCommand'), command: 'progress_task' };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', cmd);

  const makeOutput = (i: number): BashEvent => ({
    ...nextBase('BashOutput'),
    exit_code: null,
    stdout: `progress ${i}%\r`,
    stderr: null,
  });
  for (let i = 1; i <= 10; i++) {
    await vscode.commands.executeCommand('openhands._injectTerminalEvent', makeOutput(i));
  }
  // Final newline-terminated line to flush progress
  const final: BashEvent = { ...nextBase('BashOutput'), exit_code: null, stdout: 'done\n', stderr: null };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', final);

  // Exit event (should render only one [Process exited] footer)
  const exit: BashEvent = { ...nextBase('BashExit'), exit_code: 0 };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', exit);

  // Verify diagnostics reflect terminal received events and that terminal exists
  const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
  if (!diag?.terminal?.hasTerminal) throw new Error('Expected OpenHands terminal to be created');
  if (typeof diag?.terminal?.received !== 'number' || diag.terminal.received < 3) {
    throw new Error(`Expected some terminal events, got: ${JSON.stringify(diag?.terminal)}`);
  }
}
