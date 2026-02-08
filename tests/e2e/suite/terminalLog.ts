import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import type { BashEvent } from '@smolpaws/agent-sdk';
import { getDiagnostics, waitForDiagnostics } from './helpers/waitForDiagnostics';

export async function run(): Promise<void> {
  await vscode.commands.executeCommand('openhands.open');

  await waitForDiagnostics({
    label: 'chat view ready',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.chat?.hasView && diag.chat?.webviewReady),
  });

  // Force local mode to ensure terminal log is available
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('openhands.reconnect');

  // Inject a Bash command + many CR progress updates + exit. This bypasses needing an actual shell.
  const cmdId = 'e2e_cmd_1';
  let order = 0;
  const nextBase = () => ({
    id: `e2e-${cmdId}-${order}`,
    timestamp: new Date().toISOString(),
    command_id: cmdId,
    order: order++,
  });

  const cmd: BashEvent = { ...nextBase(), type: 'BashCommand', command: 'progress_task' };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', cmd);

  const makeOutput = (i: number): BashEvent => ({
    ...nextBase(),
    type: 'BashOutput',
    exit_code: null,
    stdout: `progress ${i}%\r`,
    stderr: null,
  });
  for (let i = 1; i <= 10; i++) {
    await vscode.commands.executeCommand('openhands._injectTerminalEvent', makeOutput(i));
  }
  // Final newline-terminated line to flush progress
  const final: BashEvent = { ...nextBase(), type: 'BashOutput', exit_code: null, stdout: 'done\n', stderr: null };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', final);

  // Exit event (should render only one [Process exited] footer)
  const exit: BashEvent = { ...nextBase(), type: 'BashExit', exit_code: 0 };
  await vscode.commands.executeCommand('openhands._injectTerminalEvent', exit);

  await waitForDiagnostics({
    label: 'terminal exists',
    timeoutMs: 15000,
    predicate: (diag) => Boolean(diag.terminal?.hasTerminal),
  });

  // Verify diagnostics reflect terminal received events and that output is buffered until the terminal is opened.
  const diagBeforeOpen = await getDiagnostics();
  const received = diagBeforeOpen.terminal?.received;
  if (typeof received !== 'number' || received < 3) {
    throw new Error(`Expected some terminal events, got: ${JSON.stringify(diagBeforeOpen.terminal)}`);
  }
  if (diagBeforeOpen.terminal?.ptyOpened !== false) {
    throw new Error(`Expected terminal PTY to be unopened before showing it, got: ${JSON.stringify(diagBeforeOpen.terminal)}`);
  }
  const buffered = diagBeforeOpen.terminal?.preopenBufferedChars;
  if (typeof buffered !== 'number' || buffered <= 0) {
    throw new Error(`Expected some pre-open buffered output, got: ${JSON.stringify(diagBeforeOpen.terminal)}`);
  }

  const terminal = vscode.window.terminals.find((t) => t.name === 'OpenHands');
  if (!terminal) throw new Error('Expected OpenHands terminal to exist');
  terminal.show(false);

  await waitForDiagnostics({
    label: 'terminal pty opened + flushed',
    timeoutMs: 15000,
    predicate: (diag) => diag.terminal?.ptyOpened === true && diag.terminal?.preopenBufferedChars === 0,
  });
}
