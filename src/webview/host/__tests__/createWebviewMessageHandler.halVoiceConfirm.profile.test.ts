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
});
