import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../createWebviewMessageHandler';

vi.mock('../../../hal/gemini/decisionClassifier', () => ({
  classifyHalVoiceDecision: vi.fn(async () => ({ ok: true as const, decision: 'approve_local' as const })),
}));

vi.mock('../llmProfilesStore', () => ({
  loadProfile: vi.fn(() => ({
    profileId: 'gemini-flash-hal',
    config: { provider: 'gemini', model: 'gemini-2.5-flash', baseUrl: 'https://profiles.example/v1beta' },
  })),
  listProfiles: vi.fn(() => []),
  saveProfile: vi.fn(() => undefined),
  deleteProfile: vi.fn(() => undefined),
}));

describe('createWebviewMessageHandler (HAL voice_confirm profile)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
  });

  it('uses gemini-flash-hal LLM profile config when classifying voice decision', async () => {
    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(async () => undefined),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    const context = {
      secrets: {
        get: vi.fn(async (key: string) => (key === 'GEMINI_API_KEY' ? 'secret' : undefined)),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage },
      secretRegistry: { get: vi.fn(async (key: string) => (key === 'GEMINI_API_KEY' ? 'secret' : undefined)) } as any,
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({
      type: 'halVoiceConfirmRequest',
      requestId: 'r1',
      mimeType: 'audio/wav',
      audioBase64: 'Zm9v',
    });

    const { classifyHalVoiceDecision } = await import('../../../hal/gemini/decisionClassifier');
    expect(classifyHalVoiceDecision).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://profiles.example/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'secret',
    }));
  });

  it('prefers per-profile API key over provider key when both are set', async () => {
    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(async () => undefined),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const secretRegistryGet = vi.fn(async (key: string) => {
      if (key === 'openhands.llmProfileApiKey.gemini-flash-hal') return 'profile-secret';
      if (key === 'GEMINI_API_KEY') return 'provider-secret';
      return undefined;
    });

    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage },
      secretRegistry: { get: secretRegistryGet } as any,
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({
      type: 'halVoiceConfirmRequest',
      requestId: 'r1',
      mimeType: 'audio/wav',
      audioBase64: 'Zm9v',
    });

    const { classifyHalVoiceDecision } = await import('../../../hal/gemini/decisionClassifier');
    expect(classifyHalVoiceDecision).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'profile-secret',
    }));
  });

  it('uses apiKeyRef.name from the profile config when set', async () => {
    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(async () => undefined),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const { loadProfile } = await import('../llmProfilesStore');
    (loadProfile as any).mockReturnValueOnce({
      profileId: 'gemini-flash-hal',
      config: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        baseUrl: 'https://profiles.example/v1beta',
        apiKeyRef: { kind: 'key', name: 'HAL_GEMINI_KEY' },
      },
    });

    const secretRegistryGet = vi.fn(async (key: string) => {
      if (key === 'HAL_GEMINI_KEY') return 'apiKeyRef-secret';
      if (key === 'openhands.llmProfileApiKey.gemini-flash-hal') return 'profile-secret';
      if (key === 'GEMINI_API_KEY') return 'provider-secret';
      return undefined;
    });

    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage },
      secretRegistry: { get: secretRegistryGet } as any,
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({
      type: 'halVoiceConfirmRequest',
      requestId: 'r1',
      mimeType: 'audio/wav',
      audioBase64: 'Zm9v',
    });

    const { classifyHalVoiceDecision } = await import('../../../hal/gemini/decisionClassifier');
    expect(classifyHalVoiceDecision).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'apiKeyRef-secret',
    }));
  });

  it('redacts Gemini API keys from voice confirm errors', async () => {
    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      inspect: vi.fn(() => ({})),
      update: vi.fn(async () => undefined),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const { classifyHalVoiceDecision } = await import('../../../hal/gemini/decisionClassifier');
    (classifyHalVoiceDecision as any).mockResolvedValueOnce({
      ok: false,
      error: 'bad key provider-secret',
    });

    const secretRegistryGet = vi.fn(async (key: string) => {
      if (key === 'GEMINI_API_KEY') return 'provider-secret';
      return undefined;
    });

    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage },
      secretRegistry: {
        get: secretRegistryGet,
        getRegisteredValues: () => ['provider-secret'],
      } as any,
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({
      type: 'halVoiceConfirmRequest',
      requestId: 'r1',
      mimeType: 'audio/wav',
      audioBase64: 'Zm9v',
    });

    const response = postMessage.mock.calls
      .map((call) => call[0])
      .find((payload) => payload?.type === 'halVoiceConfirmResponse');

    expect(response).toBeTruthy();
    expect(response?.ok).toBe(false);
    expect(response?.error).toContain('[REDACTED]');
    expect(response?.error).not.toContain('provider-secret');
  });
});
