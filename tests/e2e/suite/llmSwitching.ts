import * as vscode from 'vscode';
import { pollUntil } from './pollUntil';
import { startMockLlmServer } from './mockLlmServer';
import { sendAndWaitForRequestPath } from './helpers/sendAndWaitForRequestPath';
import type { MockLlmRequest } from './mockLlmServer';

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
    await vscode.commands.executeCommand('openhands.open');

    await pollUntil(async () => {
      const diag: any = await vscode.commands.executeCommand('openhands._diagnostics');
      return Boolean(diag?.chat?.hasView && diag?.chat?.webviewReady);
    }, 15000);

    const setProviderApiKey = async (provider: string, apiKey: string): Promise<void> => {
      await vscode.commands.executeCommand('openhands._setProviderApiKey', { provider, apiKey });
    };

    await setProviderApiKey('openai', 'sk-e2e-openai');
    await setProviderApiKey('anthropic', 'sk-e2e-anthropic');
    await setProviderApiKey('openrouter', 'sk-e2e-openrouter');
    await setProviderApiKey('litellm_proxy', 'sk-e2e-litellm');
    await setProviderApiKey('gemini', 'sk-e2e-gemini');

    const cfg = vscode.workspace.getConfiguration();

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

    await vscode.commands.executeCommand('openhands.reconnect');

    // For profiles-first behavior, tests must create profiles that point at the mock server.
    // This suite should avoid writing raw openhands.llm.provider/model/baseUrl/openaiApiMode keys.
    const e2eProfiles = {
      anthropic: 'e2e-switch-anthropic',
      openaiChat: 'e2e-switch-openai-chat',
      openaiAuto: 'e2e-switch-openai-auto',
      openaiResponses: 'e2e-switch-openai-responses',
      openrouterChat: 'e2e-switch-openrouter-chat',
      litellmProxy: 'e2e-switch-litellm-proxy',
      gemini: 'e2e-switch-gemini',
    } as const;
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.anthropic,
      profile: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        baseUrl: v1BaseUrl,
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.openaiChat,
      profile: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'chat_completions',
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.openaiAuto,
      profile: {
        provider: 'openai',
        model: 'gpt-5-mini',
        // Deliberately omit openaiApiMode so the factory uses its default auto selection
        // (and falls back to chat_completions when baseUrl is not the default OpenAI URL).
        baseUrl: v1BaseUrl,
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.openaiResponses,
      profile: {
        provider: 'openai',
        model: 'gpt-5-mini',
        baseUrl: v1BaseUrl,
        openaiApiMode: 'responses',
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.openrouterChat,
      profile: {
        provider: 'openrouter',
        model: 'google/gemini-2.0-flash',
        baseUrl: apiV1BaseUrl,
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.litellmProxy,
      profile: {
        provider: 'litellm_proxy',
        model: 'gpt-4o-mini',
        baseUrl: v1BaseUrl,
      },
    });
    await vscode.commands.executeCommand('openhands._createProfile', {
      profileId: e2eProfiles.gemini,
      profile: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        baseUrl: `${mock.baseUrl}/v1beta`,
      },
    });

    // 1) Anthropic
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.anthropic });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.openaiChat });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.openaiAuto });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.openaiResponses });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.openrouterChat });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.litellmProxy });
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
    await vscode.commands.executeCommand('openhands._selectProfile', { profileId: e2eProfiles.gemini });
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
