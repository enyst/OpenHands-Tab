import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

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
    emitter.sendUserMessage = vi.fn(async () => {});
    emitter.reconnect = vi.fn(() => emitter.emit('status', 'connecting'));
    emitter.pause = vi.fn(async () => {});
    emitter.resume = vi.fn(async () => {});
    emitter.approveAction = vi.fn(async () => {});
    emitter.rejectAction = vi.fn(async () => {});
    emitter.disconnect = vi.fn(() => { emitter.status = 'offline'; });
    lastConversation = emitter;
    return emitter;
  });

  return {
    Conversation,
    isBashCommand: vi.fn((event: any) => event?.type === 'BashCommand'),
    isBashOutput: vi.fn((event: any) => event?.type === 'BashOutput'),
    isBashExit: vi.fn((event: any) => event?.type === 'BashExit'),
    __getLastConversation: () => lastConversation,
    TerminalTool: vi.fn(() => new StubTool('terminal')),
    FileEditorTool: vi.fn(() => new StubTool('file_editor')),
    TaskTrackerTool: vi.fn(() => new StubTool('task_tracker')),
    BrowserTool: vi.fn(() => new StubTool('browser')),
  };
});

function createMockContext(): Partial<vscode.ExtensionContext> {
  return {
    subscriptions: [],
    extensionUri: { fsPath: '/test/extension' } as vscode.Uri,
    workspaceState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } as any,
    globalState: {
      get: vi.fn(),
      update: vi.fn(),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } as any,
    secrets: {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
      onDidChange: vi.fn(),
    } as any,
  };
}

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

  it('does not create a conversation until the tab opens', async () => {
    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    await extension.activate(mockContext);
    expect(__getLastConversation()).toBeNull();
  });
});

describe('Open tab behavior', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => { mockPanel._disposeHandler = handler; return { dispose: vi.fn() }; }),
      reveal: vi.fn(),
      _disposeHandler: null as Function | null,
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);

    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('creates the panel and conversation on first open', async () => {
    const { Conversation, __getLastConversation } = await import('@openhands/agent-sdk-ts');
    await vscode.commands.executeCommand('openhands.openTab');

    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    expect(Conversation).toHaveBeenCalled();
    expect(__getLastConversation()).toBeTruthy();
  });

  it('restores saved conversation id when available', async () => {
    (mockContext.workspaceState.get as Mock).mockReturnValue('saved-convo');
    await vscode.commands.executeCommand('openhands.openTab');

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.restoreConversation).toHaveBeenCalledWith('saved-convo');
  });
});

  describe('Command handlers', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let conversationInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);

    mockContext = createMockContext();
    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

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

  it('sends reconnect/pause/resume commands', async () => {
    await vscode.commands.executeCommand('openhands.reconnect');
    await vscode.commands.executeCommand('openhands.pauseCurrentRun');
    await vscode.commands.executeCommand('openhands.resumeCurrentRun');

    expect(conversationInstance.reconnect).toHaveBeenCalled();
    expect(conversationInstance.pause).toHaveBeenCalled();
    expect(conversationInstance.resume).toHaveBeenCalled();
  });

  it('forwards webview send/command messages to conversation', async () => {
    const handler = (mockPanel.webview.onDidReceiveMessage as Mock).mock.calls[0][0];

    await handler({ type: 'send', text: 'hello' });
    await handler({ type: 'command', command: 'approveAction' });
    await handler({ type: 'command', command: 'rejectAction', reason: 'nope' });

    expect(conversationInstance.sendUserMessage).toHaveBeenCalledWith('hello');
    expect(conversationInstance.approveAction).toHaveBeenCalled();
    expect(conversationInstance.rejectAction).toHaveBeenCalledWith('nope');
  });
});

  describe('Settings and modes', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    mockSettings = structuredClone(defaultMockSettings);
    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);
    mockContext = createMockContext();
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('sends configUpdated with remote mode', async () => {
    mockSettings.serverUrl = 'http://updated:3000';
    extension = await import('../extension');
    await extension.activate(mockContext);

    (vscode.window.showInputBox as Mock)
      .mockResolvedValueOnce('http://updated:3000')
      .mockResolvedValueOnce('default-llm')
      .mockResolvedValueOnce('claude-3-5-sonnet')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('test-key')
      .mockResolvedValueOnce('50')
      .mockResolvedValueOnce('');

    (vscode.window.showQuickPick as Mock)
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('never');

    await vscode.commands.executeCommand('openhands.configure');
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'configUpdated',
      serverUrl: 'http://updated:3000',
      mode: 'remote',
    });
  });

  it('creates a local-mode conversation when serverUrl is empty', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.mode).toBe('local');
  });
});

describe('Deactivation', () => {
  it('disconnects the conversation and disposes panel/terminal', async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
    const mockContext = createMockContext();
    const extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    extension.deactivate();

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.disconnect).toHaveBeenCalled();
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
  });
});
