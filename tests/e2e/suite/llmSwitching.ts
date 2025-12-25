import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';
import type { MockLlmRequest } from './mockLlmServer';

type WebviewActionResult = {
  sent?: boolean;
};

function assertRequestHeaders(
  request: MockLlmRequest,
  options: {
    present: string[];
    absent: string[];
    context: string;
  }
): void {
  const { present, absent, context } = options;
  const headerKeys = Object.keys(request.headers).sort().join(', ');

  for (const header of present) {
    if (typeof request.headers[header] === 'undefined') {
      throw new Error(`Expected header "${header}" to be present (${context}). Saw headers: ${headerKeys}`);
    }
  }

  for (const header of absent) {
    if (typeof request.headers[header] !== 'undefined') {
      throw new Error(`Expected header "${header}" to be absent (${context}). Saw headers: ${headerKeys}`);
    }
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
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
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

    const v1BaseUrl = `${mock.baseUrl}/v1`;
    const apiV1BaseUrl = `${mock.baseUrl}/api/v1`;

    const expectedPaths = {
      anthropicMessages: '/v1/messages',
      openaiChatCompletions: '/v1/chat/completions',
      openaiResponses: '/v1/responses',
      openrouterChatCompletions: '/api/v1/chat/completions',
      geminiStreamGenerateContent: '/v1beta/models/gemini-2.5-flash:streamGenerateContent',
    } as const;

    // 1) Anthropic
    await setLlmConfig({
      profileId: null,
      provider: 'anthropic',
      baseUrl: v1BaseUrl,
      model: 'claude-sonnet-4-20250514',
    });
    await vscode.commands.executeCommand('openhands.startNewConversation');
    const anthropicReq = await sendAndWaitForRequestPath({
      text: 'E2E step 1: anthropic',
      expectedPath: expectedPaths.anthropicMessages,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(anthropicReq, {
      present: ['x-api-key', 'anthropic-version'],
      absent: ['authorization', 'x-goog-api-key'],
      context: 'step 1: anthropic',
    });

    // 2) OpenAI-compatible (chat_completions)
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'chat_completions',
      baseUrl: v1BaseUrl,
      model: 'gpt-4o-mini',
    });
    const openaiChatReq = await sendAndWaitForRequestPath({
      text: 'E2E step 2: openai chat',
      expectedPath: expectedPaths.openaiChatCompletions,
      getRequests: () => mock.requests,
    });
    const openaiChatJson = openaiChatReq.json;
    if (!openaiChatJson || typeof openaiChatJson !== 'object' || Array.isArray(openaiChatJson)) {
      throw new Error('Expected OpenAI chat_completions request to contain a JSON object body');
    }
    assertRequestHeaders(openaiChatReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 2: openai chat_completions',
    });
    if (!('messages' in openaiChatJson)) {
      throw new Error('Expected OpenAI chat_completions request body to contain `messages`');
    }
    if ('input' in openaiChatJson) {
      throw new Error('Expected OpenAI chat_completions request body to not contain `input`');
    }

    // 3) OpenAI GPT-5 auto mode + custom baseUrl should fall back to chat_completions.
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'auto',
      baseUrl: v1BaseUrl,
      model: 'gpt-5-mini',
    });
    const openaiAutoReq = await sendAndWaitForRequestPath({
      text: 'E2E step 3: openai gpt-5 auto (custom baseUrl)',
      expectedPath: expectedPaths.openaiChatCompletions,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(openaiAutoReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 3: openai auto (custom baseUrl)',
    });

    // 4) OpenAI Responses API (gpt-5 + openaiApiMode=responses)
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      openaiApiMode: 'responses',
      baseUrl: v1BaseUrl,
      model: 'gpt-5-mini',
    });
    const openaiResponsesReq = await sendAndWaitForRequestPath({
      text: 'E2E step 4: openai responses',
      expectedPath: expectedPaths.openaiResponses,
      getRequests: () => mock.requests,
    });
    const openaiResponsesJson = openaiResponsesReq.json;
    if (!openaiResponsesJson || typeof openaiResponsesJson !== 'object' || Array.isArray(openaiResponsesJson)) {
      throw new Error('Expected OpenAI responses request to contain a JSON object body');
    }
    assertRequestHeaders(openaiResponsesReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 4: openai responses',
    });
    if (!('input' in openaiResponsesJson)) {
      throw new Error('Expected OpenAI responses request body to contain `input`');
    }
    if ('messages' in openaiResponsesJson) {
      throw new Error('Expected OpenAI responses request body to not contain `messages`');
    }

    // 5) Provider variation: openrouter adds extra headers and still hits chat_completions.
    await setLlmConfig({
      profileId: null,
      provider: 'openrouter',
      openaiApiMode: 'chat_completions',
      baseUrl: apiV1BaseUrl,
      model: 'google/gemini-2.0-flash',
    });
    const openrouterReq = await sendAndWaitForRequestPath({
      text: 'E2E step 5: openrouter header check',
      expectedPath: expectedPaths.openrouterChatCompletions,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(openrouterReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 5: openrouter',
    });
    const referer = openrouterReq.headers['http-referer'];
    const title = openrouterReq.headers['x-title'];
    if (!referer || !title) {
      throw new Error(
        `Expected OpenRouter headers on request. http-referer=${String(referer)} x-title=${String(title)}`,
      );
    }

    // 6) litellm_proxy is OpenAI-compatible.
    await setLlmConfig({
      profileId: null,
      provider: 'litellm_proxy',
      openaiApiMode: 'chat_completions',
      baseUrl: v1BaseUrl,
      model: 'gpt-4o-mini',
    });
    const litellmReq = await sendAndWaitForRequestPath({
      text: 'E2E step 6: litellm_proxy',
      expectedPath: expectedPaths.openaiChatCompletions,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(litellmReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 6: litellm_proxy',
    });

    // 7) Gemini native API (streamGenerateContent SSE).
    await setLlmConfig({
      profileId: null,
      provider: 'gemini',
      openaiApiMode: null,
      baseUrl: `${mock.baseUrl}/v1beta`,
      model: 'gemini-2.5-flash',
    });
    const geminiReq = await sendAndWaitForRequestPath({
      text: 'E2E step 7: gemini',
      expectedPath: expectedPaths.geminiStreamGenerateContent,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(geminiReq, {
      present: ['x-goog-api-key'],
      absent: ['authorization', 'x-api-key'],
      context: 'step 7: gemini',
    });

    // 8) LLM profile selection: Sonnet profile should override raw provider/model.
    await setLlmConfig({
      profileId: null,
      provider: 'openai',
      model: 'gpt-4o-mini',
      openaiApiMode: 'chat_completions',
      baseUrl: v1BaseUrl,
    });

    const setProfile = await vscode.commands.executeCommand<WebviewActionResult>('openhands._webviewAction', {
      action: 'setLlmProfileId',
      payload: { profileId: 'sonnet-45' },
    });
    if (!setProfile?.sent) {
      throw new Error(`setLlmProfileId action was not sent: ${JSON.stringify(setProfile)}`);
    }

    await pollUntil(async () => {
      const inspected = vscode.workspace.getConfiguration().inspect<string>('openhands.llm.profileId');
      const value = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
      return value === 'sonnet-45';
    }, 15000);
    const profileSonnetReq = await sendAndWaitForRequestPath({
      text: 'E2E step 8: profile sonnet-45',
      expectedPath: expectedPaths.anthropicMessages,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(profileSonnetReq, {
      present: ['x-api-key', 'anthropic-version'],
      absent: ['authorization', 'x-goog-api-key'],
      context: 'step 8: profile sonnet-45',
    });

    // 9) LLM profile selection: gpt-5-mini profile should override raw provider/model.
    await setLlmConfig({
      profileId: 'gpt-5-mini',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      openaiApiMode: 'auto',
      baseUrl: v1BaseUrl,
    });
    const profileGptReq = await sendAndWaitForRequestPath({
      text: 'E2E step 9: profile gpt-5-mini',
      expectedPath: expectedPaths.openaiChatCompletions,
      getRequests: () => mock.requests,
    });
    assertRequestHeaders(profileGptReq, {
      present: ['authorization'],
      absent: ['x-api-key', 'x-goog-api-key'],
      context: 'step 9: profile gpt-5-mini',
    });

    // Basic sanity: at least one request per step.
    const requestPaths = mock.requests.map((r) => r.path);
    const required = [
      expectedPaths.openrouterChatCompletions,
      expectedPaths.openaiChatCompletions,
      expectedPaths.anthropicMessages,
      expectedPaths.openaiResponses,
      expectedPaths.geminiStreamGenerateContent
    ];
    for (const p of required) {
      if (!requestPaths.includes(p)) {
        throw new Error(`Missing required mock request path: ${p} (saw: ${requestPaths.join(', ')})`);
      }
    }

    console.log('✓ LLM switching E2E test passed');
  } catch (err) {
    console.error('[llmSwitching] mock requests:', mock.requests.map((r) => ({ method: r.method, path: r.path })));
    throw err;
  } finally {
    await mock.close();
  }
}
