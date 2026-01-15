import * as vscode from 'vscode';
import type { DiagnosticsInfo } from './diagnosticsInfo';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getDiagnostics(): Promise<DiagnosticsInfo> {
  return await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
}

export async function waitForDiagnostics(options: {
  predicate: (diag: DiagnosticsInfo) => boolean;
  timeoutMs?: number;
  intervalMs?: number;
  label?: string;
}): Promise<DiagnosticsInfo> {
  const { predicate, timeoutMs = 10000, intervalMs = 200, label } = options;
  const deadline = Date.now() + timeoutMs;

  let lastDiag: DiagnosticsInfo | undefined;
  while (Date.now() < deadline) {
    lastDiag = await getDiagnostics();
    if (predicate(lastDiag)) return lastDiag;
    await sleep(intervalMs);
  }

  const lastError = await vscode.commands.executeCommand('openhands._queryLastError').catch(() => undefined);
  const labelSuffix = label ? ` (${label})` : '';
  throw new Error(
    `Timed out waiting for diagnostics${labelSuffix} after ${timeoutMs}ms.\n` +
    `- diag: ${JSON.stringify(lastDiag)}\n` +
    `- lastError: ${JSON.stringify(lastError)}`
  );
}

