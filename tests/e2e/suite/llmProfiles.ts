import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer, type MockLlmRequest } from './mockLlmServer';

type WebviewActionResult = {
  sent?: boolean;
};

type DiagnosticsInfo = {
  eventBacklog?: { latestSeq?: number };
};

type ErrorInfo = { seq?: number } | null;

async function sendAndWaitForRequestPath(options: {
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

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 15000);

    const cfg = vscode.workspace.getConfiguration();
    const update = async (key: string, value: unknown): Promise<void> => {
      await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    };

    // Force local mode + short runs for E2E.
    await update('openhands.serverUrl', '');
    await update('openhands.conversation.maxIterations', 10);
    await update('openhands.confirmation.policy', 'never');
    await update('openhands.agent.enableSecurityAnalyzer', false);

    const v1BaseUrl = `${mock.baseUrl}/v1`;

    // Base LLM config (used when no profile is selected).
    await update('openhands.llm.profileId', '');
    await update('openhands.llm.provider', 'anthropic');
    await update('openhands.llm.model', 'claude-e2e');
    await update('openhands.llm.baseUrl', v1BaseUrl);

    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    // Create profiles used by this suite.
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-chat',
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: 'e2e-openai-responses',
      profile: {
        provider: 'openai',
        model: 'gpt-5-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'responses',
      },
    });

    // No profile selected: should use the base anthropic config.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 1: base (anthropic)',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });

    // Select a profile and verify subsequent calls use it.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-chat' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 2: profile (openai chat_completions)',
      expectedPath: '/v1/chat/completions',
      getRequests: () => mock.requests,
    });

    // Update profile config and verify it takes effect after re-selecting.
    await vscode.commands.executeCommand('openhands._updateProfile', {
      profileId: 'e2e-openai-chat',
      patch: { openaiApiMode: 'responses', model: 'gpt-5-mini' },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-chat' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 3: updated profile (openai responses)',
      expectedPath: '/v1/responses',
      getRequests: () => mock.requests,
    });

    // Switch to a second profile.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: 'e2e-openai-responses' });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 4: second profile (openai responses)',
      expectedPath: '/v1/responses',
      getRequests: () => mock.requests,
    });

    // Clearing selection returns to base config again.
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: null });
    await sendAndWaitForRequestPath({
      text: 'E2E profiles step 5: base again (anthropic)',
      expectedPath: '/v1/messages',
      getRequests: () => mock.requests,
    });
  } finally {
    await mock.close();
  }
}
