import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveProfile as saveSdkProfile } from '@openhands/agent-sdk-ts';
import { createWebviewMessageHandler } from '../webview/host/createWebviewMessageHandler';

describe('LLM profile host CRUD (llm-profiles store)', () => {
  let tmpDir = '';

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-llm-profiles-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  const createHandler = () => {
    const postMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context: { globalStorageUri: { fsPath: tmpDir } } as any,
      host: { postMessage },
      getConversation: () => undefined,
      getConversationMode: () => 'local',
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

    return { handler, postMessage };
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
        apiKey: 'sk-test-inline',
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
    expect(response.profile.apiKey).toBeUndefined();
    expect(response.profile.headers).toBeUndefined();
  });

  it('supports explicitly loading secrets when includeSecrets=true', async () => {
    saveSdkProfile(
      'secret',
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        apiKey: 'sk-test-inline',
        headers: { Authorization: 'Bearer secret' },
      },
      { rootDir: tmpDir, includeSecrets: true },
    );

    const { handler, postMessage } = createHandler();
    await handler({ type: 'llmProfileLoadRequest', requestId: 'req1', profileId: 'secret', includeSecrets: true });

    const response = postMessage.mock.calls
      .map((args) => args[0])
      .find((payload) => payload?.type === 'llmProfileLoadResponse' && payload.requestId === 'req1') as any;

    expect(response).toMatchObject({
      type: 'llmProfileLoadResponse',
      requestId: 'req1',
      ok: true,
      profileId: 'secret',
    });
    expect(response.profile.apiKey).toBe('sk-test-inline');
    expect(response.profile.headers).toEqual({ Authorization: 'Bearer secret' });
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
        apiKey: 'sk-test-inline',
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

  it('deletes profiles from disk', async () => {
    saveSdkProfile('todelete', { model: 'gpt-5' }, { rootDir: tmpDir, includeSecrets: false });

    const { handler, postMessage } = createHandler();
    await handler({ type: 'llmProfileDeleteRequest', requestId: 'req1', profileId: 'todelete' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'llmProfileDeleteResponse',
      requestId: 'req1',
      ok: true,
      profileId: 'todelete',
    });

    await expect(fs.stat(path.join(tmpDir, 'todelete.json'))).rejects.toThrow();
  });
});

