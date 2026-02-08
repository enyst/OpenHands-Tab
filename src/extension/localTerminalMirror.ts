import * as vscode from 'vscode';
import { OpenHandsTerminalLogPseudoterminal } from '../terminal/OpenHandsTerminalLogPseudoterminal';
import {
  type BashEvent,
  isBashCommand,
  isBashExit,
  isBashOutput,
} from '@smolpaws/agent-sdk';

type TerminalMirrorState = {
  terminal: vscode.Terminal | undefined;
  terminalLogPty: OpenHandsTerminalLogPseudoterminal | undefined;
};

type MirrorTerminalEventDeps = {
  event: BashEvent;
  state: TerminalMirrorState;
  createTerminal: () => TerminalMirrorState;
  hasPrintedExitFor: (commandId: string) => boolean;
  clearPrintedExitFor: (commandId: string) => void;
  markPrintedExitFor: (commandId: string) => void;
  renderError: (err: unknown) => string;
};

export function mirrorTerminalEventToLocalTerminal({
  event,
  state,
  createTerminal,
  hasPrintedExitFor,
  clearPrintedExitFor,
  markPrintedExitFor,
  renderError,
}: MirrorTerminalEventDeps): TerminalMirrorState {
  let { terminal, terminalLogPty } = state;

  // Recreate terminal if not present or if the PTY has been closed.
  if (!terminal || !terminalLogPty || terminalLogPty.isClosed?.()) {
    const recreated = createTerminal();
    terminal = recreated.terminal;
    terminalLogPty = recreated.terminalLogPty;
    if (!terminal || !terminalLogPty) {
      return { terminal, terminalLogPty };
    }
  }

  try {
    if (isBashCommand(event)) {
      // Add a spacer only if previous output didn't end with a newline.
      terminalLogPty.ensureNewline();
      terminalLogPty.writeLine(`$ ${event.command}`);
      if (event.command_id) clearPrintedExitFor(event.command_id);
    } else if (isBashOutput(event)) {
      if (event.stdout) terminalLogPty.write(event.stdout);
      if (event.stderr) terminalLogPty.write(event.stderr);

      // Defensive: if exit_code is provided on output but no BashExit arrives, synthesize a footer once.
      const cid = event.command_id;
      const code = event.exit_code;
      if (cid && typeof code === 'number' && !hasPrintedExitFor(cid)) {
        terminalLogPty.ensureNewline();
        terminalLogPty.writeLine(`[Process exited with code ${code}]`);
        markPrintedExitFor(cid);
      }
    } else if (isBashExit(event)) {
      const cid = event.command_id;
      if (!cid || !hasPrintedExitFor(cid)) {
        terminalLogPty.ensureNewline();
        terminalLogPty.writeLine(`[Process exited with code ${event.exit_code}]`);
      }
      if (cid) {
        markPrintedExitFor(cid);
      }
    }
  } catch (err) {
    console.error(`[Terminal] Failed to write terminal event: ${renderError(err)}`);
  }

  return { terminal, terminalLogPty };
}
