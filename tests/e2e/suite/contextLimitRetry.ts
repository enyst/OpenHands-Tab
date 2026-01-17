import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';
import { waitForRequestCount } from './helpers/waitForRequestCount';
import type { DiagnosticsInfo } from './helpers/diagnosticsInfo';

type ErrorInfo = { seq?: number } | null;

type RenderedEventsInfo = {
  eventTypes?: string[];
};

type WebviewActionResult = {
  sent?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWebviewReady(timeoutMs: number): Promise<void> {
  await pollUntil(async () => {
    const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
    return Boolean(diag?.chat?.hasView && diag.chat.webviewReady);
  }, timeoutMs);
}

function isCondensationRequest(json: unknown): boolean {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const obj = json as Record<string, unknown>;
  const messages = obj.messages;
  if (!Array.isArray(messages) || messages.length < 1) return false;
  const first = messages[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return false;
  const msg = first as Record<string, unknown>;
  if (msg.role !== 'system') return false;
  return msg.content === 'You summarize conversation history for an interactive agent.';
}

function buildOpenAiChatCompletionsSseResponse(text: string) {
  return {
    type: 'sse' as const,
    status: 200,
    events: [
      { data: { choices: [{ delta: { content: [{ type: 'text', text }] } }] } },
      {
        data: {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
        },
      },
      { data: '[DONE]' },
    ],
  };
}

export async function run(): Promise<void> {
  const mock = await startMockLlmServer();

  try {
    await vscode.commands.executeCommand('openhands.open');
    await waitForWebviewReady(30000);

    // Force local mode + short runs for E2E.
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update('openhands.serverUrl', '', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.conversation.maxIterations', 50, vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.confirmation.policy', 'never', vscode.ConfigurationTarget.Global);
    await cfg.update('openhands.agent.enableSecurityAnalyzer', false, vscode.ConfigurationTarget.Global);

    // Create a profile that points at the mock server.
    const v1BaseUrl = `${mock.baseUrl}/v1`;
    const profileId = 'e2e-context-limit-retry-openai';
    await vscode.commands.executeCommand('openhands._setProviderApiKey', { provider: 'openai', apiKey: 'sk-e2e-openai' });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId,
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId });
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.startNewConversation');

    await pollUntil(async () => {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      return diag?.mode === 'local' && typeof diag?.conversationId === 'string' && diag.conversationId.length > 0;
    }, 30000);

    // Ensure no prior traffic makes assertions flaky.
    mock.reset();

    // Seed conversation history through real LLM turns (ensures the Agent's event log has ids).
    // Make assistant responses long so the condensation prompt hits its per-event preview cap.
    const longAssistant = `seed-assistant ${'y'.repeat(2_000)}`;
    mock.setScript({
      path: '/v1/chat/completions',
      responses: Array.from({ length: 200 }, () => buildOpenAiChatCompletionsSseResponse(longAssistant)),
    });

    for (let i = 0; i < 40; i += 1) {
      const userText = `seed-user-${i} ` + 'x'.repeat(2_000);
      await sendAndWaitForRequestPath({
        text: userText,
        expectedPath: '/v1/chat/completions',
        getRequests: () => mock.requests,
      });
    }

    // Step 2: first request fails with context_length_exceeded, then we should condense + retry.
    mock.setScript({
      path: '/v1/chat/completions',
      responses: [
        { type: 'json', status: 400, body: { error: { code: 'context_length_exceeded' } } },
      ],
    });

    const beforeReqCount = mock.requests.length;
    const beforeRendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
    const beforeCondensations = (beforeRendered?.eventTypes ?? []).filter((t) => t === 'Condensation').length;
    const beforeError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
    const beforeErrorSeq = typeof beforeError?.seq === 'number' ? beforeError.seq : -1;

    const send = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'sendMessage',
      payload: { text: 'E2E context-limit retry step 2' },
    });
    if (!send?.sent) throw new Error(`sendMessage action was not sent: ${JSON.stringify(send)}`);

    try {
      await waitForRequestCount({
        expectedPath: '/v1/chat/completions',
        baselineIndex: beforeReqCount,
        additionalCount: 3,
        timeoutMs: 60000,
        pollIntervalMs: 250,
        getRequests: () => mock.requests,
        beforeErrorSeq,
      });

      await pollUntil(async () => {
        const newRequests = mock.requests.slice(beforeReqCount);
        const chatReqs = newRequests.filter((r) => r.path === '/v1/chat/completions');
        const mainReqs = chatReqs.filter((r) => !isCondensationRequest(r.json));
        const condenseReqs = chatReqs.filter((r) => isCondensationRequest(r.json));
        if (mainReqs.length < 2) return false;
        if (condenseReqs.length < 1) return false;
        const rendered = await vscode.commands.executeCommand<RenderedEventsInfo>('openhands._queryRenderedEvents');
        const condensationCount = (rendered?.eventTypes ?? []).filter((t) => t === 'Condensation').length;
        const hasCondensation = condensationCount > beforeCondensations;
        if (!hasCondensation) return false;

        const afterError = await vscode.commands.executeCommand<ErrorInfo>('openhands._queryLastError');
        const afterErrorSeq = typeof afterError?.seq === 'number' ? afterError.seq : -1;
        return !(afterError && afterErrorSeq > beforeErrorSeq);
      }, 60000, 250);
    } catch (err) {
      const diag = await vscode.commands.executeCommand<DiagnosticsInfo>('openhands._diagnostics');
      const lastError: any = await vscode.commands.executeCommand('openhands._queryLastError');
      const rendered: any = await vscode.commands.executeCommand('openhands._queryRenderedEvents');
      const recent = mock.requests
        .slice(beforeReqCount)
        .map((r) => ({ path: r.path, isCondensation: isCondensationRequest(r.json) }))
        .slice(-25);
      throw new Error(
        `Timed out waiting for context-limit condensation + retry.\n` +
        `- diag: ${JSON.stringify(diag)}\n` +
        `- lastError: ${JSON.stringify(lastError)}\n` +
        `- renderedEvents: ${JSON.stringify(rendered)}\n` +
        `- recentRequestsSinceSend: ${JSON.stringify(recent)}\n` +
        `- original: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const newRequests = mock.requests.slice(beforeReqCount);
    const newChatReqs = newRequests.filter((r) => r.path === '/v1/chat/completions');
    if (newChatReqs.length !== 3) {
      throw new Error(`Expected exactly 3 chat completions requests after triggering send, got ${newChatReqs.length}`);
    }

    const mainIndices: number[] = [];
    let condenseIndex = -1;
    for (let i = 0; i < newRequests.length; i += 1) {
      const req = newRequests[i];
      if (req.path === '/v1/chat/completions' && !isCondensationRequest(req.json)) {
        mainIndices.push(i);
      }
      if (condenseIndex === -1 && isCondensationRequest(req.json)) {
        condenseIndex = i;
      }
    }

    if (mainIndices.length !== 2) {
      throw new Error(`Expected exactly 2 non-condensation requests (fail + retry), got ${mainIndices.length}`);
    }
    const condenseCount = newRequests.filter((r) => isCondensationRequest(r.json)).length;
    if (condenseCount !== 1) {
      throw new Error(`Expected exactly 1 condensation request, got ${condenseCount}`);
    }
    if (condenseIndex < 0) {
      throw new Error('Expected at least 1 condensation LLM request, but none was recorded');
    }
    if (!(mainIndices[0] < condenseIndex && condenseIndex < mainIndices[1])) {
      throw new Error(
        `Expected condensation request to occur between the two main requests; main=${JSON.stringify(mainIndices)} condense=${condenseIndex}`,
      );
    }

    // Guard against runaway retries.
    await sleep(1000);
    const afterRequests = mock.requests.slice(beforeReqCount);
    const finalChatReqs = afterRequests.filter((r) => r.path === '/v1/chat/completions');
    if (finalChatReqs.length !== 3) {
      throw new Error(`Expected no extra chat requests after completion (still 3), got ${finalChatReqs.length}`);
    }
  } finally {
    await mock.close();
  }
}
