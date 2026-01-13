import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'path';
import * as os from 'os';

const defaultMockSettings = {
  serverUrl: 'http://localhost:3000',
  llm: {
    usageId: 'default-llm',
    model: 'claude-3-5-sonnet-20241022',
    baseUrl: undefined,
  },
  agent: {
    enableSecurityAnalyzer: false,
  },
  conversation: {
    maxIterations: 50,
  },
  confirmation: {
    policy: 'never',
    riskyThreshold: 'HIGH',
    confirmUnknown: true,
  },
  secrets: {
    llmApiKey: 'test-llm-key',
    sessionApiKey: 'test-session-key',
  },
};

let mockSettings = structuredClone(defaultMockSettings);

vi.mock('../settings/SettingsManager', () => ({
  SettingsManager: vi.fn(function (this: any) {
    this.get = vi.fn(async () => mockSettings);
    this.update = vi.fn(async (partial: any) => {
      mockSettings = { ...mockSettings, ...partial };
    });
    return this;
  }),
}));

vi.mock('../settings/VscodeSettingsAdapter', () => ({
  VscodeSettingsAdapter: vi.fn(function (this: any) {
    return this;
  }),
}));

let lastConversation: any = null;
vi.mock('@openhands/agent-sdk-ts', () => {
  class StubTool {
    name: string;
    description = '';
    schema: Record<string, unknown> = {};

    constructor(name: string) {
      this.name = name;
    }
  }

  class AgentContext {
    constructor(_params?: unknown) {}
  }

  class SecretRegistry {
    constructor(_storage?: unknown) {}

    set = vi.fn();

    getRegisteredValues = vi.fn(() => []);
  }

  const Conversation = vi.fn((options: any) => {
    const emitter = new EventEmitter() as any;
    emitter.mode = options?.serverUrl ? 'remote' : 'local';
    emitter.conversationId = options?.conversationId ?? null;
    emitter.status = 'offline';
    emitter.getConversationId = vi.fn(() => emitter.conversationId);
    emitter.getStatus = vi.fn(() => emitter.status);
    emitter.setSettings = vi.fn();
    emitter.restoreConversation = vi.fn((id: string) => { emitter.conversationId = id; });
    emitter.startNewConversation = vi.fn(async () => {
      emitter.conversationId = 'test-conversation-id';
      emitter.status = 'online';
      emitter.emit('conversationStarted', emitter.conversationId);
      emitter.emit('status', 'online');
      return emitter.conversationId;
    });
    emitter.sendUserMessage = vi.fn(async () => { });
    emitter.reconnect = vi.fn(() => emitter.emit('status', 'connecting'));
    emitter.pause = vi.fn(async () => { });
    emitter.resume = vi.fn(async () => { });
    emitter.approveAction = vi.fn(async () => { });
    emitter.rejectAction = vi.fn(async () => { });
    emitter.disconnect = vi.fn(() => { emitter.status = 'offline'; });
    lastConversation = emitter;
    return emitter;
  });

  class FileStore {
    static listConversations(rootDir?: string): string[] {
      const dir = rootDir ?? path.join(process.cwd(), '.openhands', 'conversations');
      if (!fsSync.existsSync(dir)) return [];
      return fsSync
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    }
  }

  return {
    AgentContext,
    Conversation,
    SecretRegistry,
    isBashCommand: vi.fn((event: any) => event?.type === 'BashCommand'),
    isBashOutput: vi.fn((event: any) => event?.type === 'BashOutput'),
    isBashExit: vi.fn((event: any) => event?.type === 'BashExit'),
    FileStore,
    isEvent: vi.fn((candidate: any) => !!candidate && typeof candidate === 'object' && typeof candidate.kind === 'string'),
    isMessageEvent: vi.fn((event: any) => event?.kind === 'MessageEvent' && !!event.llm_message && typeof event.llm_message === 'object'),
    isTextContent: vi.fn((content: any) => content?.type === 'text'),
    __getLastConversation: () => lastConversation,
    TerminalTool: vi.fn(() => new StubTool('terminal')),
    FileEditorTool: vi.fn(() => new StubTool('file_editor')),
    TaskTrackerTool: vi.fn(() => new StubTool('task_tracker')),
    GlobTool: vi.fn(() => new StubTool('glob')),
    GrepTool: vi.fn(() => new StubTool('grep')),
    BrowserTool: vi.fn(() => new StubTool('browser')),
    AskOracleTool: vi.fn(() => new StubTool('ask_oracle')),
    FinishTool: vi.fn(() => new StubTool('finish')),
  };
});

function createMockContext(): Partial<vscode.ExtensionContext> {
  return {
    subscriptions: [],
    extensionUri: { fsPath: '/test/extension' } as vscode.Uri,
    workspaceState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(() => []),
    } satisfies vscode.Memento,
    globalState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } satisfies vscode.Memento & { setKeysForSync(keys: readonly string[]): void },
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    } satisfies vscode.SecretStorage,
  };
}

const mockOpenHandsTerminalLog = (options: { capturePty?: boolean } = {}) => {
  const writes: string[] = [];
  const terminals: any[] = [];
  let lastPty: any;

  (vscode.window.createTerminal as Mock).mockImplementation((createOptions: any) => {
    const pty = createOptions?.pty;
    if (options.capturePty) lastPty = pty;
    if (pty?.onDidWrite) pty.onDidWrite((chunk: string) => writes.push(chunk));
    if (typeof pty?.open === 'function') pty.open();
    const terminal = { show: vi.fn(), dispose: vi.fn() } as any;
    terminals.push(terminal);
    return terminal;
  });

  return { writes, terminals, getLastPty: () => lastPty };
};

describe('Extension Activation', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);
    mockContext = createMockContext();
    extension = await import('../extension');
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('registers commands on activation', async () => {
    await extension.activate(mockContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalled();
  });

  it('does not create a conversation until the chat view resolves', async () => {
    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    await extension.activate(mockContext);
    expect(__getLastConversation()).toBeNull();
  });
});

describe('Secret indicator sync', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);
    mockContext = createMockContext();
    extension = await import('../extension');
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('writes a non-secret status marker for settings-backed secrets', async () => {
    await extension.activate(mockContext);

    const cfg = vscode.workspace.getConfiguration();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((cfg.update as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.sessionApiKey', '✓ set', vscode.ConfigurationTarget.Global);
    expect(cfg.update).not.toHaveBeenCalledWith(
      'openhands.secrets.sessionApiKey',
      defaultMockSettings.secrets.sessionApiKey,
      vscode.ConfigurationTarget.Global
    );
  });

  it('writes status markers for secrets stored in SecretStorage', async () => {
    const secretStorage = new Map<string, string>([['OPENAI_API_KEY', 'sk-test']]);
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));
    mockContext.secrets.store = vi.fn(async (key: string, value: string) => {
      secretStorage.set(key, value);
    });
    mockContext.secrets.delete = vi.fn(async (key: string) => {
      secretStorage.delete(key);
    });

    await extension.activate(mockContext);

    const cfg = vscode.workspace.getConfiguration();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((cfg.update as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.openaiApiKey', '✓ set', vscode.ConfigurationTarget.Global);
    expect(cfg.update).not.toHaveBeenCalledWith(
      'openhands.secrets.openaiApiKey',
      secretStorage.get('OPENAI_API_KEY'),
      vscode.ConfigurationTarget.Global
    );
  });

  it('clears status markers when the underlying secret is not set', async () => {
    (vscode as any).__getMockConfigValues().set('openhands.secrets.openaiApiKey', '✓ set');

    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));
    mockContext.secrets.store = vi.fn(async (key: string, value: string) => {
      secretStorage.set(key, value);
    });
    mockContext.secrets.delete = vi.fn(async (key: string) => {
      secretStorage.delete(key);
    });

    await extension.activate(mockContext);

    const cfg = vscode.workspace.getConfiguration();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((cfg.update as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.openaiApiKey', undefined, vscode.ConfigurationTarget.Global);
  });

  it('updates the status marker after a secret set command', async () => {
    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));
    mockContext.secrets.store = vi.fn(async (key: string, value: string) => {
      secretStorage.set(key, value);
    });
    mockContext.secrets.delete = vi.fn(async (key: string) => {
      secretStorage.delete(key);
    });

    await extension.activate(mockContext);

    const cfg = vscode.workspace.getConfiguration();
    (cfg.update as Mock).mockClear();

    (vscode.window.showInputBox as Mock).mockResolvedValue('sk-new');
    await vscode.commands.executeCommand('openhands.setOpenAiApiKey');

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((cfg.update as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.openaiApiKey', '✓ set', vscode.ConfigurationTarget.Global);
  });
});

function createMockWebviewView() {
  const view: any = {
    visible: true,
    show: vi.fn(),
    webview: {
      html: '',
      options: {},
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn((handler: Function) => {
        view._messageHandler = handler;
        return { dispose: vi.fn() };
      }),
      asWebviewUri: vi.fn((uri: any) => uri),
      cspSource: 'vscode-webview:',
    },
    onDidDispose: vi.fn((handler: Function) => {
      view._disposeHandler = handler;
      return { dispose: vi.fn() };
    }),
    _messageHandler: null as Function | null,
    _disposeHandler: null as Function | null,
  };

  return view;
}

async function resolveChatView(mockContext: any) {
  const provider = (vscode.window.registerWebviewViewProvider as Mock).mock.calls.find(
    (call) => call[0] === 'openhands.agent'
  )?.[1];
  expect(provider).toBeTruthy();

  const view = createMockWebviewView();
  const { Conversation } = await import('@openhands/agent-sdk-ts');
  const beforeCalls = (Conversation as Mock).mock.calls.length;
  provider.resolveWebviewView(view);

  // ensureConversationAndConnection() is async and invoked without await
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((Conversation as Mock).mock.calls.length > beforeCalls) break;
    await new Promise((r) => setTimeout(r, 0));
  }

  return view;
}

describe('Chat view behavior', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);

    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('creates the conversation when the chat view resolves', async () => {
    const { Conversation, __getLastConversation } = await import('@openhands/agent-sdk-ts');
    await resolveChatView(mockContext);

    expect(Conversation).toHaveBeenCalled();
    expect(__getLastConversation()).toBeTruthy();
  });

  it('does not auto-restore saved conversation on first chat view resolve', async () => {
    // Intentionally does not restore on first open - users may return after weeks
    // and won't remember what the conversation was about
    (mockContext.workspaceState.get as Mock).mockReturnValue('saved-convo');
    await resolveChatView(mockContext);

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.restoreConversation).not.toHaveBeenCalled();
  });

  it('refreshes the active conversation when LLM settings change', async () => {
    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    mockSettings = {
      ...mockSettings,
      llm: {
        ...mockSettings.llm,
        profileId: 'gpt-5-mini',
      },
    };

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.llm' || key === 'openhands.llm.profileId',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((conv.setSettings as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(conv.setSettings).toHaveBeenCalledWith(mockSettings);
  });

  it('refreshes the active conversation when confirmation settings change', async () => {
    const view = await resolveChatView(mockContext);
    expect(view).toBeTruthy();

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const conv = __getLastConversation();
    expect(conv).toBeTruthy();

    mockSettings = {
      ...mockSettings,
      confirmation: {
        ...mockSettings.confirmation,
        policy: 'always',
      },
    };

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.confirmation' || key === 'openhands.confirmation.policy',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((conv.setSettings as Mock).mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(conv.setSettings).toHaveBeenCalledWith(mockSettings);
  });

  it('starts a fresh conversation on serverUrl changes (no auto-restore)', async () => {
    await resolveChatView(mockContext);
    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const initial = __getLastConversation();
    expect(initial).toBeTruthy();

    // Even if a saved conversation id exists for the next mode, serverUrl changes should not restore it.
    (mockContext.workspaceState.get as Mock).mockImplementation((key: string) => {
      if (key === 'openhands.conversationId.local') return 'local-saved';
      if (key === 'openhands.conversationId.remote') return 'remote-saved';
      return undefined;
    });

    // Switch from remote → local by clearing serverUrl.
    mockSettings = { ...mockSettings, serverUrl: '' as any };
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');
    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.serverUrl',
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const current = __getLastConversation();
      if (current && current !== initial) break;
      await new Promise((r) => setTimeout(r, 0));
    }

    const next = __getLastConversation();
    expect(next).toBeTruthy();
    expect(next).not.toBe(initial);
    expect(next.restoreConversation).not.toHaveBeenCalled();

    // Mode switches clear the saved id for the target scope so no implicit restore can occur later.
    expect(mockContext.workspaceState.update).toHaveBeenCalledWith('openhands.conversationId.local', undefined);
  });

  it('updates the local AgentContext system prompt suffix with the active editor file path', async () => {
    mockSettings = { ...mockSettings, serverUrl: '' as any };
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

    const { Conversation } = await import('@openhands/agent-sdk-ts');
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

  it('auto-disables tool-call summarization when Gemini key is missing (local mode)', async () => {
    const priorEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      mockSettings = {
        ...mockSettings,
        serverUrl: '',
        llm: { ...mockSettings.llm, provider: 'openai' },
        agent: { ...mockSettings.agent, summarizeToolCalls: true },
      };

      const view = await resolveChatView(mockContext);
      expect(mockSettings.agent.summarizeToolCalls).toBe(false);

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

describe('Command handlers', () => {
  let mockContext: any;
  let extension: any;
  let conversationInstance: any;
  let chatView: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);

    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
    chatView = await resolveChatView(mockContext);

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    conversationInstance = __getLastConversation();
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('starts a new conversation', async () => {
    await vscode.commands.executeCommand('openhands.startNewConversation');
    expect(conversationInstance.startNewConversation).toHaveBeenCalled();
  });

  it('starts a new conversation to explain the editor selection', async () => {
    mockSettings.serverUrl = undefined as any;
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', '');

    (vscode.window as any).activeTextEditor = {
      selection: {
        isEmpty: false,
        start: { line: 3, character: 2 },
        end: { line: 5, character: 10 },
      },
      document: {
        languageId: 'typescript',
        uri: {
          scheme: 'file',
          fsPath: '/test/workspace/src/example.ts',
          toString: () => 'file:///test/workspace/src/example.ts',
        },
        getText: vi.fn(() => 'const x = 1;'),
      },
    };
    (vscode.window as any).visibleTextEditors = [(vscode.window as any).activeTextEditor];
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test/workspace' } }];

    await vscode.commands.executeCommand('openhands.explainSelection');

    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    const latestConversation = __getLastConversation();

    expect(latestConversation.startNewConversation).toHaveBeenCalled();
    expect(latestConversation.sendUserMessage).toHaveBeenCalled();
    const message = (latestConversation.sendUserMessage as unknown as Mock).mock.calls[0]?.[0] as string;
    expect(message).toContain('Please explain this code:');
    expect(message).toContain('/test/workspace/src/example.ts:4:3-6:11');
    expect(message).toContain('const x = 1;');
    expect(message).toContain('<environment information>');
    expect(message).toContain('Active editor: example.ts');
    expect(message).toContain('Open editors:');
    expect(message).toContain('- example.ts');
    expect(message).toContain('</environment information>');
  });

  it('sends reconnect/pause/resume commands', async () => {
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.pauseCurrentRun');
    await vscode.commands.executeCommand('openhands.resumeCurrentRun');

    expect(conversationInstance.reconnect).toHaveBeenCalled();
    expect(conversationInstance.pause).toHaveBeenCalled();
    expect(conversationInstance.resume).toHaveBeenCalled();
  });

  it('forwards webview send/command messages to conversation', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    await handler({ type: 'send', text: 'hello' });
    await handler({ type: 'command', command: 'approveAction' });
    await handler({ type: 'command', command: 'rejectAction', reason: 'nope' });

    expect(conversationInstance.sendUserMessage).toHaveBeenCalledWith('hello');
    expect(conversationInstance.approveAction).toHaveBeenCalled();
    expect(conversationInstance.rejectAction).toHaveBeenCalledWith('nope');
  });

  it('does not show a duplicate error popup for teleportAction failures', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    const exec = vscode.commands.executeCommand as unknown as Mock;
    const orig = exec.getMockImplementation();
    try {
      exec.mockImplementation(async (name: string, ...args: any[]) => {
        if (name === 'openhands._teleportToRemoteRuntime') {
          throw new Error('boom');
        }
        return orig?.(name, ...args);
      });

      await handler({ type: 'command', command: 'teleportAction' });
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    } finally {
      exec.mockImplementation(orig);
    }
  });

  it('opens a diff view for openWorkspaceDiff messages', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    (vscode.commands.executeCommand as Mock).mockClear();

    await handler({ type: 'openWorkspaceDiff', path: 'README.md', oldContent: 'before', newContent: 'after' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.diff',
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Diff:'),
      expect.objectContaining({ preview: false }),
    );
  });

  it('returns history from the stable conversation store', async () => {
    const handler = chatView._messageHandler;
    expect(handler).toBeTypeOf('function');

    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-tab-homedir-'));
    const cfgValues = (vscode as any).__getMockConfigValues?.();

    try {
      const conversationId = 'local-test-convo';
      const conversationsRoot = path.join(tmpHome, '.openhands', 'conversations-vscode');
      cfgValues?.set('openhands.conversation.storeRoot', conversationsRoot);
      const conversationDir = path.join(conversationsRoot, conversationId);
      await fs.mkdir(conversationDir, { recursive: true });

      const eventsPath = path.join(conversationDir, 'events.jsonl');
      const messageEvent = {
        kind: 'MessageEvent',
        llm_message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello from history' }],
        },
      };
      await fs.writeFile(eventsPath, `${JSON.stringify(messageEvent)}\n`, 'utf8');

      (chatView.webview.postMessage as Mock).mockClear();
      await handler({ type: 'requestHistory' });

      const historyMessage = (chatView.webview.postMessage as Mock).mock.calls
        .map((call) => call[0])
        .find((payload) => payload?.type === 'historyList') as any;

      expect(historyMessage).toBeTruthy();
      expect(historyMessage.conversations).toEqual([
        expect.objectContaining({
          id: conversationId,
          firstMessage: 'hello from history',
        }),
      ]);
    } finally {
      cfgValues?.delete('openhands.conversation.storeRoot');
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('Settings and modes', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);
    mockContext = createMockContext();
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('configure command opens VS Code settings', async () => {
    mockSettings.serverUrl = 'http://updated:3000';
    extension = await import('../extension');
    await extension.activate(mockContext);

    await vscode.commands.executeCommand('openhands.configure');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      '@ext:openhands.openhands-tab'
    );
  });

  it('recreates the terminal after user closes it', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, terminals } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-1',
      order: 0,
      command: 'first_command',
    });
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);

    const closeHandler = (vscode.window.onDidCloseTerminal as Mock).mock.calls[0]?.[0];
    closeHandler?.(terminals[0]);

    conv?.emit('terminal', {
      id: 'bash-2',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-2',
      order: 0,
      command: 'second_command',
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2);
    const joined = writes.join('');
    expect(joined).toContain('$ first_command');
    expect(joined).toContain('$ second_command');
  });

  it('handles ANSI sequences and emoji across chunk boundary', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    const coloredOutput = '\x1b[31m' + 'red'.repeat(5500) + '\x1b[0m' + '🚀'.repeat(100);

    conv?.emit('terminal', {
      id: 'bash-9',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:08.000Z',
      command_id: 'tc-5',
      order: 0,
      command: 'echo_colored_emoji',
    });
    conv?.emit('terminal', {
      id: 'bash-10',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:09.000Z',
      command_id: 'tc-5',
      order: 1,
      exit_code: 0,
      stdout: coloredOutput,
      stderr: null,
    });

    const joined = writes.join('');
    expect(joined).toContain('$ echo_colored_emoji\r\n');
    expect(joined).toContain(coloredOutput);
    expect(joined).toContain('\x1b[31m');
    expect(joined).toContain('\x1b[0m');
  });

  it('creates a local-mode conversation when serverUrl is empty', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.mode).toBe('local');
  });

  it('streams BashEvents into the OpenHands terminal log in local mode', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    // Test 1: Basic command and stdout
    conv?.emit('terminal', {
      id: 'bash-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-1',
      order: 0,
      command: 'pwd && ls -la',
    });
    conv?.emit('terminal', {
      id: 'bash-2',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-1',
      order: 1,
      exit_code: 0,
      stdout: '/test/workspace\n',
      stderr: null,
    });

    // Test 2: Stderr output
    conv?.emit('terminal', {
      id: 'bash-3',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:02.000Z',
      command_id: 'tc-2',
      order: 0,
      command: 'command_with_error',
    });
    conv?.emit('terminal', {
      id: 'bash-4',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:03.000Z',
      command_id: 'tc-2',
      order: 1,
      exit_code: 1,
      stdout: null,
      stderr: 'Error: command not found\n',
    });

    // Test 3: Newline normalization (mixed \n and \r\n)
    conv?.emit('terminal', {
      id: 'bash-5',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:04.000Z',
      command_id: 'tc-3',
      order: 0,
      command: 'echo "hello\r\nworld\n"',
    });
    conv?.emit('terminal', {
      id: 'bash-6',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:05.000Z',
      command_id: 'tc-3',
      order: 1,
      exit_code: 0,
      stdout: 'hello\r\nworld\n', // Input with mixed newlines
      stderr: null,
    });

    // Test 4: Output chunking (very large string)
    const largeOutput = 'a'.repeat(20_000); // Larger than PTY_WRITE_CHUNK_SIZE (16KB)
    conv?.emit('terminal', {
      id: 'bash-7',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:06.000Z',
      command_id: 'tc-4',
      order: 0,
      command: 'echo_large_output',
    });
    conv?.emit('terminal', {
      id: 'bash-8',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:07.000Z',
      command_id: 'tc-4',
      order: 1,
      exit_code: 0,
      stdout: largeOutput,
      stderr: null,
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ name: 'OpenHands' }));
    expect(writes.join('')).toContain('$ pwd && ls -la\r\n'); // Command output includes a newline
    expect(writes.join('')).toContain('/test/workspace\r\n');
    expect(writes.join('')).toContain('$ command_with_error\r\n');
    expect(writes.join('')).toContain('Error: command not found\r\n');
    expect(writes.join('')).toContain('$ echo "hello\r\nworld\r\n"\r\n');
    expect(writes.join('')).toContain('hello\r\nworld\r\n');
    expect(writes.join('')).toContain('$ echo_large_output\r\n');
    expect(writes.join('')).toContain(largeOutput);

  });

  it('streams stdout and stderr from a single BashOutput event into the OpenHands terminal log', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes } = mockOpenHandsTerminalLog();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-mixed-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-mixed-1',
      order: 0,
      command: 'mixed_output',
    });
    conv?.emit('terminal', {
      id: 'bash-mixed-2',
      type: 'BashOutput',
      timestamp: '2025-01-01T00:00:01.000Z',
      command_id: 'tc-mixed-1',
      order: 1,
      exit_code: 0,
      stdout: 'stdout line\n',
      stderr: 'stderr line\n',
    });

    const joined = writes.join('');
    expect(joined).toContain('$ mixed_output\r\n');
    expect(joined).toContain('stdout line\r\n');
    expect(joined).toContain('stderr line\r\n');
  });

  it('coalesces CR-only progress output in the OpenHands terminal log', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-1',
      order: 0,
      command: 'progress_output',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    // Simulate progress updates arriving in multiple chunks (including CSI K split across writes).
    ptyInstance.write('Downloading 1%');
    ptyInstance.write('\rDownloading 2%');
    ptyInstance.write('\rDownloading 3%');
    ptyInstance.write('\n');

    ptyInstance.write('Longer line that should be cleared');
    ptyInstance.write('\rShort');
    ptyInstance.write('\u001b');
    ptyInstance.write('[K\n');

    const joined = writes.join('');
    expect(joined).toContain('$ progress_output\r\n');
    expect(joined).toContain('Downloading 3%\r\n');
    expect(joined).not.toContain('Downloading 1%');
    expect(joined).not.toContain('Downloading 2%');
    expect(joined).toContain('Short\r\n');
    expect(joined).not.toContain('Longer line that should be cleared');
    expect(joined).not.toContain('\u001b[K');
  });

  it('warns once and flushes when the progress coalescing buffer overflows', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-overflow-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-overflow-1',
      order: 0,
      command: 'progress_overflow',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    const huge = 'a'.repeat(200_001);
    ptyInstance.write(huge);
    ptyInstance.write('\n');
    ptyInstance.write('b'.repeat(200_001));
    ptyInstance.write('\n');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Terminal progress renderer overflowed')
    );

    warn.mockRestore();
    expect(writes.join('')).toContain('$ progress_overflow\r\n');
  });

  it('coalesces ANSI-colored progress output (including split CSI sequences)', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-progress-color-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-progress-color-1',
      order: 0,
      command: 'progress_colored',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    ptyInstance.write('\u001b[32mDownloading 1%\u001b[0m');
    ptyInstance.write('\r\u001b[33mDownloading 2%\u001b[0m');
    // Split escape sequence across writes.
    ptyInstance.write('\r\u001b');
    ptyInstance.write('[34mDownloading 3%\u001b[0m');
    ptyInstance.write('\n');

    const joined = writes.join('');
    expect(joined).toContain('$ progress_colored\r\n');
    expect(joined).toContain('\u001b[34mDownloading 3%\u001b[0m\r\n');
    expect(joined).not.toContain('Downloading 1%');
    expect(joined).not.toContain('Downloading 2%');
  });

  it('strips terminal string control sequences (OSC/DCS) from the OpenHands terminal log', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    const { writes, getLastPty } = mockOpenHandsTerminalLog({ capturePty: true });

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();

    conv?.emit('terminal', {
      id: 'bash-sanitize-1',
      type: 'BashCommand',
      timestamp: '2025-01-01T00:00:00.000Z',
      command_id: 'tc-sanitize-1',
      order: 0,
      command: 'sanitize_output',
    });

    const ptyInstance = getLastPty();
    expect(ptyInstance).toBeTruthy();

    // OSC with BEL terminator
    ptyInstance.write('hello\u001b]0;title\u0007world\n');
    // OSC with ST (ESC \\) terminator
    ptyInstance.write('a\u001b]8;;https://example.com\u001b\\b\n');
    // DCS with ST terminator
    ptyInstance.write('x\u001bPqstuff\u001b\\y\n');

    const joined = writes.join('');
    expect(joined).toContain('$ sanitize_output\r\n');
    expect(joined).toContain('helloworld\r\n');
    expect(joined).toContain('ab\r\n');
    expect(joined).toContain('xy\r\n');
    expect(joined).not.toContain('\u001b]');
    expect(joined).not.toContain('\u001bP');
  });
});


describe('Deactivation', () => {
  it('disconnects the conversation and disposes terminal', async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    const mockContext = createMockContext();
    const extension = await import('../extension');
    await extension.activate(mockContext);
    await resolveChatView(mockContext);

    extension.deactivate();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.disconnect).toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });
});
