import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveProfile as saveSdkProfile, SecretRegistry } from '@smolpaws/agent-sdk';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';

describe('LLM profile host CRUD (llm-profiles store)', () => {
  let tmpDir = '';

  beforeEach(async () => {
    (vscode as any).__resetMocks();
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-llm-profiles-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  const createHandler = (options?: { conversation?: any; mode?: 'local' | 'remote' }) => {
    const postMessage = vi.fn(async () => true);
    const secretValues = new Map<string, string>();
    const secrets = {
      get: vi.fn(async (key: string) => secretValues.get(key)),
      store: vi.fn(async (key: string, value: string) => {
        secretValues.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        secretValues.delete(key);
      }),
    };
    const secretRegistry = new SecretRegistry(secrets as any, null);
    const handler = createWebviewMessageHandler({
      context: { globalStorageUri: { fsPath: tmpDir }, secrets } as any,
      host: { postMessage },
      secretRegistry,
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => options?.conversation,
      getConversationMode: () => options?.mode ?? 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => tmpDir,
      getLlmProfilesStoreRoot: () => tmpDir,
      setWebviewReadyState: () => {},
      setLastKnownLlmLabel: () => {},
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => {},
      onRenderedEventsResponse: () => {},
      onUiStateResponse: () => {},
      onHalStateResponse: () => {},
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => {},
    });

    return { handler, postMessage, secrets, secretRegistry };
  };

  it('lists profiles from the configured root dir', async () => {
    saveSdkProfile('a', { model: 'gpt-5-mini' }, { rootDir: tmpDir, includeSecrets: false });
    saveSdkProfile('b', { model: 'gpt-5' }, { rootDir: tmpDir, includeSecrets: false });

    const { handler, postMessage } = createHandler();
    await handler({ type: 'llmProfilesListRequest', requestId: 'req1' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'llmProfilesListResponse',
      requestId: 'req1',
      ok: true,
      profiles: ['a', 'b'],
    });
  });

  it('loads profiles and strips inline secrets by default', async () => {
    saveSdkProfile(
      'secret',
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKeyRef: { kind: 'inline', value: 'sk-test-inline' },
        headers: { Authorization: 'Bearer secret' },
      },
      { rootDir: tmpDir, includeSecrets: true },
    );

    const { handler, postMessage } = createHandler();
    await handler({ type: 'llmProfileLoadRequest', requestId: 'req1', profileId: 'secret' });

    const response = postMessage.mock.calls
      .map((args) => args[0])
      .find((payload) => payload?.type === 'llmProfileLoadResponse' && payload.requestId === 'req1') as any;

    expect(response).toMatchObject({
      type: 'llmProfileLoadResponse',
      requestId: 'req1',
      ok: true,
      profileId: 'secret',
    });
    expect(response.profile.model).toBe('gpt-5-mini');
    expect(response.profile.apiKeyRef).toBeUndefined();
    expect(response.profile.headers).toBeUndefined();
  });

  it('saves profiles with includeSecrets=false by default', async () => {
    const { handler, postMessage } = createHandler();

    await handler({
      type: 'llmProfileSaveRequest',
      requestId: 'req1',
      profileId: 'saved',
      profile: {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKeyRef: { kind: 'inline', value: 'sk-test-inline' },
        headers: { Authorization: 'Bearer secret' },
      },
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'llmProfileSaveResponse',
      requestId: 'req1',
      ok: true,
      profileId: 'saved',
    });

    const content = await fs.readFile(path.join(tmpDir, 'saved.json'), 'utf8');
    expect(content).not.toContain('sk-test-inline');
    expect(content).not.toContain('Authorization');
  });

  it('clearing a profile API key invalidates the SecretRegistry cache', async () => {
    const { handler, secrets, secretRegistry } = createHandler();
    const key = 'openhands.llmProfileApiKey.a';

    await secrets.store(key, 'sk-test');
    await expect(secretRegistry.get(key)).resolves.toBe('sk-test');

    await handler({ type: 'llmProfileApiKeySetRequest', requestId: 'req1', profileId: 'a', apiKey: '' });

    await expect(secretRegistry.get(key)).resolves.toBeUndefined();
  });

  it('deletes profiles and clears stored API keys', async () => {
    saveSdkProfile('a', { model: 'gpt-5-mini' }, { rootDir: tmpDir, includeSecrets: false });

    const { handler, postMessage, secrets, secretRegistry } = createHandler();
    const key = 'openhands.llmProfileApiKey.a';

    await secrets.store(key, 'sk-test');
    await expect(secretRegistry.get(key)).resolves.toBe('sk-test');

    await handler({ type: 'llmProfileDeleteRequest', requestId: 'req1', profileId: 'a' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'llmProfileDeleteResponse',
      requestId: 'req1',
      ok: true,
      profileId: 'a',
    });
    expect(secrets.delete).toHaveBeenCalledWith(key);
    await expect(secretRegistry.get(key)).resolves.toBeUndefined();
    await expect(fs.stat(path.join(tmpDir, 'a.json'))).rejects.toThrow();
  });

  it('applies selected LLM profileId to the active conversation immediately', async () => {
    const conversation = { getStatus: () => 'online', setSettings: vi.fn() };
    const { handler } = createHandler({ conversation });

    await handler({ type: 'setLlmProfileId', profileId: 'test-gpt-4' });

    expect(conversation.setSettings).toHaveBeenCalledTimes(1);
    expect(conversation.setSettings.mock.calls[0]?.[0]?.llm?.profileId).toBe('test-gpt-4');
  });

  it('warns that remote mode profile switching applies on the next new conversation', async () => {
    const conversation = { getStatus: () => 'online', setSettings: vi.fn() };
    const { handler, postMessage } = createHandler({ conversation, mode: 'remote' });

    await handler({ type: 'setLlmProfileId', profileId: 'test-gpt-4' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'statusMessage',
      level: 'warn',
      message: expect.stringContaining('Remote mode'),
      autoDismiss: true,
      autoDismissDelay: 8000,
    });
  });
});
