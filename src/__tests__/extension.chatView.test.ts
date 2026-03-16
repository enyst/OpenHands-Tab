import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  defaultMockSettings,
  getMockSettings,
  resetHarnessState,
  resolveChatView,
  setMockSettings,
} from './extension.test.harness';

describe('Chat view behavior', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    resetHarnessState();
    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('creates the conversation when the chat view resolves', async () => {
    const { Conversation, __getLastConversation } = await import('@smolpaws/agent-sdk');
    await resolveChatView(mockContext);

    expect(Conversation).toHaveBeenCalled();
    expect(__getLastConversation()).toBeTruthy();
  });

  it('injects a per-server runtimeSessionApiKey when present', async () => {
    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    const { getServerRuntimeSessionApiKeySecretKey } = await import('../auth/serverRuntimeSessionApiKeys');
    const keyInfo = getServerRuntimeSessionApiKeySecretKey(getMockSettings().serverUrl);
    expect(keyInfo.ok).toBe(true);
    if (!keyInfo.ok) return;

    secretStorage.set(keyInfo.secretKey, 'runtime-token');

    await resolveChatView(mockContext);

    const { Conversation } = await import('@smolpaws/agent-sdk');
    const options = (Conversation as unknown as Mock).mock.calls.at(-1)?.[0] as any;
    expect(options?.settings?.secrets?.runtimeSessionApiKey).toBe('runtime-token');
    expect(options?.serverUrl).toBeUndefined();
    expect(options?.workspace?.kind).toBe('remote');
    expect(options?.workspace?.root).toBe('workspace/project');
  });

  it('does not inject runtimeSessionApiKey when missing', async () => {
    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    await resolveChatView(mockContext);

    const { Conversation } = await import('@smolpaws/agent-sdk');
    const options = (Conversation as unknown as Mock).mock.calls.at(-1)?.[0] as any;
    expect(options?.settings?.secrets?.runtimeSessionApiKey).toBeUndefined();
  });

  it('prompts to set runtimeSessionApiKey on remote auth failure for non-cloud servers', async () => {
    await resolveChatView(mockContext);

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    (vscode.window.showWarningMessage as Mock).mockResolvedValue('Set Key');

    conv.emit('error', new Error('Authentication failed (HTTP 401)'));

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const calls = (vscode.commands.executeCommand as Mock).mock.calls;
      if (calls.some((call) => call?.[0] === 'openhands.setRuntimeSessionApiKey')) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('openhands.setRuntimeSessionApiKey');
  });

  it('prompts to cloudLogin on remote auth failure for cloud servers', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: 'https://app.all-hands.dev' as any });
    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    const { getServerCloudApiKeySecretKey } = await import('../auth/serverCloudApiKeys');
    const cloudKeyInfo = getServerCloudApiKeySecretKey(getMockSettings().serverUrl);
    expect(cloudKeyInfo.ok).toBe(true);
    if (!cloudKeyInfo.ok) return;
    secretStorage.set(cloudKeyInfo.secretKey, 'cloud-key');

    await resolveChatView(mockContext);

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    (vscode.window.showWarningMessage as Mock).mockResolvedValue('Login');

    conv.emit('error', new Error('Authentication failed (HTTP 403)'));

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const calls = (vscode.commands.executeCommand as Mock).mock.calls;
      if (calls.some((call) => call?.[0] === 'openhands.cloudLogin')) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('openhands.cloudLogin');
  });

  it('does not auto-restore saved conversation on first chat view resolve', async () => {
    // Intentionally does not restore on first open - users may return after weeks
    // and won't remember what the conversation was about
    (mockContext.workspaceState.get as Mock).mockReturnValue('saved-convo');
    await resolveChatView(mockContext);

    const conv = (await import('@smolpaws/agent-sdk')).__getLastConversation?.();
    expect(conv?.restoreConversation).not.toHaveBeenCalled();
  });

  it('auto-pauses when the chat view becomes hidden (and avoids spamming)', async () => {
    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    (conv.pause as Mock).mockClear();

    // Hide -> pause once
    view.visible = false;
    view._visibilityHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(1);

    // Still hidden -> do not pause again
    view._visibilityHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(1);

    // Show -> no pause
    view.visible = true;
    view._visibilityHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(1);

    // Hide again -> pause again
    view.visible = false;
    view._visibilityHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(2);
  });

  it('does not double-pause when the chat view is hidden then disposed', async () => {
    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    (conv.pause as Mock).mockClear();

    view.visible = false;
    view._visibilityHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(1);

    view._disposeHandler?.();
    expect(conv.pause).toHaveBeenCalledTimes(1);
  });

  it('refreshes the active conversation when LLM settings change', async () => {
    const secretStorage = new Map<string, string>();
    const { getServerRuntimeSessionApiKeySecretKey } = await import('../auth/serverRuntimeSessionApiKeys');
    const runtimeKeyInfo = getServerRuntimeSessionApiKeySecretKey(defaultMockSettings.serverUrl);
    expect(runtimeKeyInfo.ok).toBe(true);
    if (!runtimeKeyInfo.ok) throw new Error(`Expected runtime session API key secret key to resolve for ${defaultMockSettings.serverUrl}`);
    secretStorage.set(runtimeKeyInfo.secretKey, defaultMockSettings.secrets.runtimeSessionApiKey);
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    setMockSettings({
      ...getMockSettings(),
      llm: {
        ...getMockSettings().llm,
        profileId: 'gpt-5-mini',
      },
    });

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.llm' || key === 'openhands.llm.profileId',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((conv.setSettings as Mock).mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(conv.setSettings).toHaveBeenCalledWith(getMockSettings());
  });

  it('refreshes the active conversation when confirmation settings change', async () => {
    const secretStorage = new Map<string, string>();
    const { getServerRuntimeSessionApiKeySecretKey } = await import('../auth/serverRuntimeSessionApiKeys');
    const runtimeKeyInfo = getServerRuntimeSessionApiKeySecretKey(defaultMockSettings.serverUrl);
    expect(runtimeKeyInfo.ok).toBe(true);
    if (!runtimeKeyInfo.ok) throw new Error(`Expected runtime session API key secret key to resolve for ${defaultMockSettings.serverUrl}`);
    secretStorage.set(runtimeKeyInfo.secretKey, defaultMockSettings.secrets.runtimeSessionApiKey);
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    setMockSettings({
      ...getMockSettings(),
      confirmation: {
        ...getMockSettings().confirmation,
        policy: 'always',
      },
    });

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.confirmation' || key === 'openhands.confirmation.policy',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((conv.setSettings as Mock).mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(conv.setSettings).toHaveBeenCalledWith(getMockSettings());
  });

  it('starts a fresh conversation on serverUrl changes (no auto-restore)', async () => {
    await resolveChatView(mockContext);
    const { __getLastConversation } = await import('@smolpaws/agent-sdk');
    const initial = __getLastConversation();
    expect(initial).toBeTruthy();

    // Even if a saved conversation id exists for the next mode, serverUrl changes should not restore it.
    (mockContext.workspaceState.get as Mock).mockImplementation((key: string) => {
      if (key === 'openhands.conversationId.local') return 'local-saved';
      if (key === 'openhands.conversationId.remote') return 'remote-saved';
      return undefined;
    });

    // Switch from remote -> local by clearing serverUrl.
    setMockSettings({ ...getMockSettings(), serverUrl: '' as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');
    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.serverUrl',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const current = __getLastConversation();
      if (current && current !== initial) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const next = __getLastConversation();
    expect(next).toBeTruthy();
    expect(next).not.toBe(initial);
    expect(next.restoreConversation).not.toHaveBeenCalled();

    // Mode switches clear the saved id for the target scope so no implicit restore can occur later.
    expect(mockContext.workspaceState.update).toHaveBeenCalledWith('openhands.conversationId.local', undefined);
  });

  it('updates the local AgentContext system prompt suffix with the active editor file path', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: '' as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    (vscode.window as any).activeTextEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/initial.ts',
        },
      },
    };

    await resolveChatView(mockContext);

    const { Conversation } = await import('@smolpaws/agent-sdk');
    const options = (Conversation as unknown as Mock).mock.calls.at(-1)?.[0] as any;
    expect(options?.agentContext).toBeTruthy();
    const agentContext = options.agentContext as any;

    expect(agentContext.systemMessageSuffix).toBe('Currently opened in the editor: /test/workspace/src/initial.ts');

    const nextEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/next.ts',
        },
      },
    };
    (vscode.window as any).activeTextEditor = nextEditor;
    (vscode as any).__triggerActiveTextEditorChange(nextEditor);
    expect(agentContext.systemMessageSuffix).toBe('Currently opened in the editor: /test/workspace/src/next.ts');

    (vscode.window as any).activeTextEditor = undefined;
    (vscode as any).__triggerActiveTextEditorChange(undefined);
    expect(agentContext.systemMessageSuffix).toBeUndefined();
  });

  it('updates the local AgentContext user message suffix with current environment info', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: '' as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    const initialEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/initial.ts',
        },
      },
    };
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    (vscode.window as any).activeTextEditor = initialEditor;
    (vscode.window as any).visibleTextEditors = [initialEditor];

    await resolveChatView(mockContext);

    const { Conversation } = await import('@smolpaws/agent-sdk');
    const options = (Conversation as unknown as Mock).mock.calls.at(-1)?.[0] as any;
    expect(options?.agentContext).toBeTruthy();
    const agentContext = options.agentContext as any;

    expect(agentContext.userMessageSuffix).toContain('<environment information>');
    expect(agentContext.userMessageSuffix).toContain('Active editor: initial.ts');
    expect(agentContext.userMessageSuffix).toContain('Open editors:');
    expect(agentContext.userMessageSuffix).toContain('- none');
    expect(agentContext.userMessageSuffix).toContain('</environment information>');

    const nextEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/next.ts',
        },
      },
    };
    (vscode.window as any).activeTextEditor = nextEditor;
    (vscode.window as any).visibleTextEditors = [nextEditor];
    (vscode as any).__triggerActiveTextEditorChange(nextEditor);
    expect(agentContext.userMessageSuffix).toContain('Active editor: next.ts');
    expect(agentContext.userMessageSuffix).toContain('- none');

    (vscode.window as any).activeTextEditor = undefined;
    (vscode.window as any).visibleTextEditors = [];
    (vscode as any).__triggerActiveTextEditorChange(undefined);
    expect(agentContext.userMessageSuffix).toContain('Active editor: none');
    expect(agentContext.userMessageSuffix).toContain('- none');
  });

  it('lists other open tabs (excluding the active editor) in the local environment info suffix', async () => {
    setMockSettings({ ...getMockSettings(), serverUrl: '' as any });
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    const initialEditor = {
      document: {
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/initial.ts',
        },
      },
    };
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];
    (vscode.window as any).activeTextEditor = initialEditor;
    (vscode.window as any).visibleTextEditors = [initialEditor];
    (vscode.window as any).tabGroups = {
      all: [
        {
          tabs: [
            { input: { uri: { scheme: 'file', fsPath: '/test/workspace/src/initial.ts' } } },
            { input: { uri: { scheme: 'file', fsPath: '/test/workspace/src/other.ts' } } },
            { input: { uri: { scheme: 'file', fsPath: '/test/workspace/README.md' } } },
          ],
        },
      ],
    };

    await resolveChatView(mockContext);

    const { Conversation } = await import('@smolpaws/agent-sdk');
    const options = (Conversation as unknown as Mock).mock.calls.at(-1)?.[0] as any;
    expect(options?.agentContext).toBeTruthy();
    const agentContext = options.agentContext as any;

    expect(agentContext.userMessageSuffix).toContain('Active editor: initial.ts');
    expect(agentContext.userMessageSuffix).toContain('Open editors:');
    expect(agentContext.userMessageSuffix).toContain('- other.ts');
    expect(agentContext.userMessageSuffix).toContain('- README.md');
    expect(agentContext.userMessageSuffix).not.toContain('- initial.ts');
  });

  it('auto-disables tool-call summarization when Gemini key is missing (local mode)', async () => {
    const priorEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      setMockSettings({
        ...getMockSettings(),
        serverUrl: '',
        llm: { ...getMockSettings().llm, provider: 'openai' },
        agent: { ...getMockSettings().agent, summarizeToolCalls: true },
      });

      const view = await resolveChatView(mockContext);
      expect(getMockSettings().agent.summarizeToolCalls).toBe(false);

      const posted = (view.webview.postMessage as Mock).mock.calls.map((call) => call[0]);
      expect(posted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'statusMessage',
            level: 'error',
            message: expect.stringContaining('tool summarization disabled'),
          }),
        ])
      );
    } finally {
      if (priorEnv !== undefined) process.env.GEMINI_API_KEY = priorEnv;
    }
  });
});
