import * as vscode from 'vscode';
import { pollUntil } from '../pollUntil';
import type { MockLlmRequest } from '../mockLlmServer';

type WebviewActionResult = {
  sent?: boolean;
};

type DiagnosticsInfo = {
  eventBacklog?: { latestSeq?: number };
};

type ErrorInfo = { seq?: number } | null;

export async function sendAndWaitForRequestPath(options: {
  text: string;
  expectedPath: string;
  timeoutMs?: number;
  getRequests: () => MockLlmRequest[];
}): Promise<MockLlmRequest> {
  const { text, expectedPath, timeoutMs = 45000, getRequests } = options;
  const beforeReqCount = getRequests().length;
  const beforeDiag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
  const beforeSeq = typeof beforeDiag?.eventBacklog?.latestSeq === 'number' ? beforeDiag.eventBacklog.latestSeq : 0;
  const beforeError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
  const beforeErrorSeq = typeof beforeError?.seq === 'number' ? beforeError.seq : -1;

  const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
    action: 'sendMessage',
    payload: { text }
  });
  if (!send?.sent) {
    throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);
  }

  try {
    await pollUntil(async () => {
      const reqs = getRequests();
      const hasExpected = reqs.slice(beforeReqCount).some((r) => r.path === expectedPath);
      if (!hasExpected) return false;
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      const seq = typeof diag?.eventBacklog?.latestSeq === 'number' ? diag.eventBacklog.latestSeq : 0;
      return seq > beforeSeq;
    }, timeoutMs, 200);
  } catch (err) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    const lastError: any = await vscode.commands.executeCommand('openhands._queryLastError');
    const recent = getRequests()
      .slice(beforeReqCount)
      .map((r) => r.path)
      .slice(-20);
    throw new Error(
      `Timed out waiting for mock request (${expectedPath}).\n` +
      `- diag: ${JSON.stringify(diag)}\n` +
      `- lastError: ${JSON.stringify(lastError)}\n` +
      `- requestsSinceSend: ${recent.join(', ') || '(none)'}\n` +
      `- original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const afterError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
  const afterErrorSeq = typeof afterError?.seq === 'number' ? afterError.seq : -1;
  if (afterError && afterErrorSeq > beforeErrorSeq) {
    const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
    throw new Error(
      `Detected error event(s) after sending message.\n` +
      `- diag: ${JSON.stringify(diag)}\n` +
      `- lastError: ${JSON.stringify(afterError)}`,
    );
  }

  const last = getRequests()
    .slice(beforeReqCount)
    .filter((r) => r.path === expectedPath)
    .slice(-1)[0];
  if (!last) {
    throw new Error(`Expected mock request (${expectedPath}) after send, but none was recorded`);
  }
  return last;
}

