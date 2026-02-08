import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { BashEvent } from '@smolpaws/agent-sdk';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
  }, 15000);

  const cfg = vscode.workspace.getConfiguration();
  await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('openhands.reconnect');

  const cmdId = `e2e_cmd_${Date.now().toString(36)}`;
  let order = 0;
  const nextBase = () => ({
    id: `e2e-${cmdId}-${order}`,
    timestamp: new Date().toISOString(),
    command_id: cmdId,
    order: order++,
  });

  const cmd: BashEvent = { ...nextBase(), type: 'BashCommand', command: 'long_task' };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', cmd);

  for (let i = 0; i < 50; i++) {
    const out: BashEvent = { ...nextBase(), type: 'BashOutput', exit_code: null, stdout: `step ${i}\r`, stderr: null };
    await vscode.commands.executeCommand('openhands._injectTerminalEvent', out);
  }

  const exit: BashEvent = { ...nextBase(), type: 'BashExit', exit_code: 0 };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', exit);

  // Ensure terminal exists and we saw lots of events (coalesced)
  const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  if (!diag?.terminal?.hasTerminal) throw new Error('Expected OpenHands terminal to exist');
  if (typeof diag?.terminal?.received !== 'number' || diag.terminal.received < 10) {
    throw new Error(`Expected many terminal events, got: ${JSON.stringify(diag?.terminal)}`);
  }
}
