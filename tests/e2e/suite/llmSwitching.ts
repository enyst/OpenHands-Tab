import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';

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
  getRequests: () => Array<{ path: string }>;
}): Promise<void> {
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
}

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    console.log('[llmSwitching] env:', {
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
      LITELLM_API_KEY: Boolean(process.env.LITELLM_API_KEY),
    });

    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 15000);

    const cfg = vscode.workspace.getConfiguration();
    const setLlmConfig = async (
      config: Record<string, unknown>,
      options: { reconnect?: boolean } = {},
    ): Promise<void> => {
      for (const [key, value] of Object.entries(config)) {
        await cfg.update(`openhands.llm.${key}`, value, vscode.ConfigurationTarget.Global);
      }
      if (options.reconnect ?? true) {
        await vscode.commands.executeCommand('openhands.reconnect');
      }
    };

    // Force local mode + short runs for E2E.
    await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
    // Iterations are tracked across a conversation, not per-user-message.
    // Keep it small but large enough to cover this suite’s multiple sends.
    await cfg.update('openhands.conversation.maxIterations', 10, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'never', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.agent.enableSecurityAnalyzer', false, vscode.ConfigurationTarget.Global);

    // 1) Anthropic
    await setLlmConfig({
      profileId: null,
      provider: 'anthropic',
      baseUrl: mock.baseUrl,
      model: 'claude-sonnet-4-20250514',
    });
    await vscode.commands.executeCommand('openhands.startNewConversation');
    await sendAndWaitForRequestPath({
      text: 'E2E step 1: anthropic',
      expectedPath: '/messages',
      getRequests: () => mock.requests,
    });

    // 2) OpenAI-compatible (chat_completions)
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'chat_completions',
      baseUrl: mock.baseUrl,
      model: 'gpt-4o-mini',
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 2: openai chat',
      expectedPath: '/chat/completions',
      getRequests: () => mock.requests,
    });

    // 3) OpenAI GPT-5 auto mode + custom baseUrl should fall back to chat_completions.
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'auto',
      baseUrl: mock.baseUrl,
      model: 'gpt-5-mini',
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 3: openai gpt-5 auto (custom baseUrl)',
      expectedPath: '/chat/completions',
      getRequests: () => mock.requests,
    });

    // 4) OpenAI Responses API (gpt-5 + openaiApiMode=responses)
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'responses',
      baseUrl: mock.baseUrl,
      model: 'gpt-5-mini',
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 4: openai responses',
      expectedPath: '/responses',
      getRequests: () => mock.requests,
    });

    // 5) Provider variation: openrouter adds extra headers and still hits chat_completions.
    await setLlmConfig({
      profileId: null,
      provider: 'openrouter',
      openaiApiMode: 'chat_completions',
      baseUrl: mock.baseUrl,
      model: 'google/gemini-2.0-flash',
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 5: openrouter header check',
      expectedPath: '/chat/completions',
      getRequests: () => mock.requests,
    });

    const openrouterReq = mock.requests
      .slice()
      .reverse()
      .find((r) => r.path === '/chat/completions');
    if (!openrouterReq) {
      throw new Error('Expected an OpenRouter /chat/completions request');
    }
    const referer = openrouterReq.headers['http-referer'];
    const title = openrouterReq.headers['x-title'];
    if (!referer || !title) {
      throw new Error(`Expected OpenRouter headers on request. http-referer=${String(referer)} x-title=${String(title)}`);
    }

    // 6) LLM profile selection: Sonnet profile should override raw provider/model.
    await setLlmConfig({
      profileId: 'sonnet-45',
      provider: 'openai',
      model: 'gpt-4o-mini',
      openaiApiMode: 'chat_completions',
      baseUrl: mock.baseUrl,
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 6: profile sonnet-45',
      expectedPath: '/messages',
      getRequests: () => mock.requests,
    });

    // 7) LLM profile selection: gpt-5-mini profile should override raw provider/model.
    await setLlmConfig({
      profileId: 'gpt-5-mini',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      openaiApiMode: 'auto',
      baseUrl: mock.baseUrl,
    });
    await sendAndWaitForRequestPath({
      text: 'E2E step 7: profile gpt-5-mini',
      expectedPath: '/chat/completions',
      getRequests: () => mock.requests,
    });

    // Basic sanity: at least one request per step.
    const paths = mock.requests.map((r) => r.path);
    const required = ['/messages', '/chat/completions', '/responses'];
    for (const p of required) {
      if (!paths.includes(p)) throw new Error(`Missing required mock request path: ${p} (saw: ${paths.join(', ')})`);
    }

    console.log('✓ LLM switching E2E test passed');
  } catch (err) {
    console.error('[llmSwitching] mock requests:', mock.requests.map((r) => ({ method: r.method, path: r.path })));
    throw err;
  } finally {
    await mock.close();
  }
}
