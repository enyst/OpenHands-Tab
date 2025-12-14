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

  it('does not auto-restore saved conversation on first panel open', async () => {
    // Intentionally does not restore on first open - users may return after weeks
    // and won't remember what the conversation was about
    (mockContext.workspaceState.get as Mock).mockReturnValue('saved-convo');
    await vscode.commands.executeCommand('openhands.openTab');

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.restoreConversation).not.toHaveBeenCalled();
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

  it('creates a local-mode conversation when serverUrl is empty', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const conv = (await import('@openhands/agent-sdk-ts')).__getLastConversation?.();
    expect(conv?.mode).toBe('local');
  });

  it('streams BashEvents into the OpenHands terminal log in local mode', async () => {
    mockSettings.serverUrl = undefined as any;
    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const writes: string[] = [];
    (vscode.window.createTerminal as Mock).mockImplementation((options: any) => {
      const pty = options?.pty;
      if (pty?.onDidWrite) {
        pty.onDidWrite((chunk: string) => writes.push(chunk));
      }
      return { show: vi.fn(), dispose: vi.fn() } as any;
    });

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
