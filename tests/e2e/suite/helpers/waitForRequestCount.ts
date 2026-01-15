import * as vscode from 'vscode';
import { pollUntil } from '../pollUntil';
import type { MockLlmRequest } from '../mockLlmServer';
import type { DiagnosticsInfo } from './diagnosticsInfo';

type ErrorInfo = { seq?: number } | null;

export async function waitForRequestCount(options: {
  expectedPath: string;
  baselineIndex: number;
  additionalCount: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  getRequests: () => MockLlmRequest[];
  beforeSeq?: number;
  beforeErrorSeq?: number;
}): Promise<MockLlmRequest[]> {
  const {
    expectedPath,
    baselineIndex,
    additionalCount,
    timeoutMs = 45000,
    pollIntervalMs = 200,
    getRequests,
    beforeSeq,
    beforeErrorSeq,
  } = options;

  const initialReqCount = getRequests().length;
  if (baselineIndex > initialReqCount) {
    throw new Error(`baselineIndex (${baselineIndex}) > current request count (${initialReqCount})`);
  }

  const predicate = async () => {
    const newRequests = getRequests().slice(baselineIndex);
    const matching = newRequests.filter((r) => r.path === expectedPath);
    if (matching.length < additionalCount) return false;

    if (typeof beforeSeq === 'number') {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      const latestSeq = typeof diag?.eventBacklog?.latestSeq === 'number' ? diag.eventBacklog.latestSeq : 0;
      if (latestSeq <= beforeSeq) return false;
    }

    if (typeof beforeErrorSeq === 'number') {
      const lastError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
      const lastErrorSeq = typeof lastError?.seq === 'number' ? lastError.seq : -1;
      if (lastError && lastErrorSeq > beforeErrorSeq) {
        throw new Error(`Detected error event(s) after baseline (seq ${lastErrorSeq} > ${beforeErrorSeq}).`);
      }
    }

    return true;
  };

  try {
    await pollUntil(predicate, timeoutMs, pollIntervalMs);
  } catch (err) {
    const diag = (await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics')) ?? {};
    const lastError = (await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError')) ?? null;
    const newRequests = getRequests().slice(baselineIndex);
    const matching = newRequests.filter((r) => r.path === expectedPath);
    const recentPaths = newRequests.map((r) => r.path).slice(-25);
    const original = err instanceof Error ? err.message : String(err);
    const isTimeout = original.startsWith('pollUntil timed out after');
    const headline = isTimeout
      ? `Timed out waiting for ${additionalCount} mock request(s) to (${expectedPath}).`
      : `waitForRequestCount failed while waiting for ${additionalCount} mock request(s) to (${expectedPath}).`;

    throw new Error(
      `${headline}\n` +
      `- baselineIndex: ${baselineIndex}\n` +
      `- observedMatching: ${matching.length}\n` +
      `- diag: ${JSON.stringify(diag)}\n` +
      `- lastError: ${JSON.stringify(lastError)}\n` +
      `- recentPathsSinceBaseline: ${recentPaths.join(', ') || '(none)'}\n` +
      `- original: ${original}`,
      { cause: err },
    );
  }

  return getRequests()
    .slice(baselineIndex)
    .filter((r) => r.path === expectedPath);
}
