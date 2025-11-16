import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as vscode from 'vscode';

/**
 * Comprehensive test suite for extension.ts
 *
 * This test suite provides 45+ unit tests covering all major functionality:
 * - Extension Activation (4 tests)
 * - openTab Command (5 tests)
 * - Command Handlers (7 tests)
 * - Message Routing (7 tests)
 * - Event Streaming (4 tests)
 * - Bash Integration (5 tests)
 * - Settings Updates (4 tests)
 * - Panel Lifecycle (3 tests)
 * - Workspace State (2 tests)
 * - E2E Support (4 tests)
 */

// Track ConnectionManager instances for testing
let lastConnectionManagerInstance: any = null;
// Mock ConnectionManager
vi.mock('../connection/ConnectionManager', () => ({
  ConnectionManager: vi.fn(function (this: any, serverUrl: string, callbacks: any) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
    this.settings = null;
    this.conversationId = null;
    this.status = 'disconnected';

    this.startNewConversation = vi.fn(async () => {
      this.conversationId = 'test-conversation-id';
      this.callbacks.onConversationId?.(this.conversationId);
      this.callbacks.onStatus?.('online');
      return this.conversationId;
    });

    this.sendUserMessage = vi.fn(async () => {});
    this.reconnect = vi.fn(() => {
      this.callbacks.onStatus?.('connecting');
    });
    this.pause = vi.fn(async () => {});
    this.resume = vi.fn(async () => {});
    this.approveAction = vi.fn(async () => {});
    this.rejectAction = vi.fn(async () => {});
    this.disconnect = vi.fn(() => {});
    this.setSettings = vi.fn((settings: any) => {
      this.settings = settings;
    });
    this.setServerUrl = vi.fn((url: string) => {
      this.serverUrl = url;
    });
    this.restoreConversation = vi.fn((id: string) => {
      this.conversationId = id;
    });
    this.getConversationId = vi.fn(() => this.conversationId);
    this.getStatus = vi.fn(() => this.status);

    // Store instance for test access
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastConnectionManagerInstance = this;

    return this;
  }),
  __getLastInstance: () => lastConnectionManagerInstance,
}));

// Mock SettingsManager
vi.mock('../settings/SettingsManager', () => ({
  SettingsManager: vi.fn(function (this: any) {
    this.get = vi.fn(async () => ({
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
    }));
    this.update = vi.fn(async () => {});
    return this;
  }),
}));

// Mock VscodeSettingsAdapter
vi.mock('../settings/VscodeSettingsAdapter', () => ({
  VscodeSettingsAdapter: vi.fn(function (this: any) {
    return this;
  }),
}));

// Mock BashEventsClient
vi.mock('../terminal/BashEventsClient', () => ({
  BashEventsClient: vi.fn(function (this: any, serverUrl: string, callbacks: any, sessionApiKey?: string) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
    this.sessionApiKey = sessionApiKey;
    this.status = 'disconnected';

    this.connect = vi.fn(() => {
      this.status = 'connected';
      this.callbacks.onStatus?.('connected');
    });
    this.disconnect = vi.fn(() => {
      this.status = 'disconnected';
    });
    this.setServerUrl = vi.fn((url: string) => {
      this.serverUrl = url;
    });
    this.setSessionApiKey = vi.fn((key?: string) => {
      this.sessionApiKey = key;
    });
    this.reconnect = vi.fn(() => {
      this.callbacks.onStatus?.('connecting');
    });
    this.injectEvent = vi.fn((event: any) => {
      this.callbacks.onEvent?.(event);
    });
    this.getStatus = vi.fn(() => this.status);

    return this;
  }),
}));

// Mock agent-sdk type guards
vi.mock('../types/agent-sdk', () => ({
  isBashCommand: vi.fn((event: any) => event?.type === 'bash_command'),
  isBashOutput: vi.fn((event: any) => event?.type === 'bash_output'),
  isBashExit: vi.fn((event: any) => event?.type === 'bash_exit'),
}));

/**
 * Factory function to create a mock ExtensionContext
 * This reduces duplication and improves maintainability across test suites
 */
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


    mockContext = createMockContext();


    // Dynamically import the extension module
    extension = await import('../extension');
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should activate extension successfully', async () => {
    await extension.activate(mockContext);

    expect(vscode.commands.registerCommand).toHaveBeenCalled();
    expect(mockContext.subscriptions.length).toBeGreaterThan(0);
  });

  it('should register all required commands on activation', async () => {
    await extension.activate(mockContext);

    const registerCommand = vscode.commands.registerCommand as Mock;
    const registeredCommands = registerCommand.mock.calls.map(call => call[0]);

    expect(registeredCommands).toContain('openhands.openTab');
    expect(registeredCommands).toContain('openhands.startNewConversation');
    expect(registeredCommands).toContain('openhands.configure');
    expect(registeredCommands).toContain('openhands.reconnect');
    expect(registeredCommands).toContain('openhands.pauseCurrentRun');
    expect(registeredCommands).toContain('openhands.resumeCurrentRun');
  });

  it('should initialize ConnectionManager lazily (not on activation)', async () => {
    const { ConnectionManager } = await import('../connection/ConnectionManager');

    await extension.activate(mockContext);

    // ConnectionManager should not be created until a command is executed
    expect(ConnectionManager).not.toHaveBeenCalled();
  });

  it('should register configuration change listeners', async () => {
    await extension.activate(mockContext);

    expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
  });
});

describe('openTab Command', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => {
        mockPanel._disposeHandler = handler;
        return { dispose: vi.fn() };
      }),
      reveal: vi.fn(),
      _disposeHandler: null as Function | null,
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);


    mockContext = createMockContext();


    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should create webview panel on first openTab execution', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'openhandsTab',
      'OpenHands Tab',
      vscode.ViewColumn.Beside,
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
      })
    );
  });

  it('should reuse existing panel on subsequent openTab calls', async () => {
    await vscode.commands.executeCommand('openhands.openTab');
    await vscode.commands.executeCommand('openhands.openTab');

    // Should only create panel once
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    // Should reveal existing panel
    expect(mockPanel.reveal).toHaveBeenCalledTimes(2);
  });

  it('should set correct panel properties and options', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    const call = (vscode.window.createWebviewPanel as Mock).mock.calls[0];
    const options = call[3];

    expect(options.enableScripts).toBe(true);
    expect(options.retainContextWhenHidden).toBe(true);
    expect(options.localResourceRoots).toBeDefined();
  });

  it('should load HTML content into webview', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    expect(mockPanel.webview.html).toContain('<!DOCTYPE html>');
    expect(mockPanel.webview.html).toContain('OpenHands Tab');
  });

  it('should initialize ConnectionManager on first openTab', async () => {
    const { ConnectionManager } = await import('../connection/ConnectionManager');

    await vscode.commands.executeCommand('openhands.openTab');

    expect(ConnectionManager).toHaveBeenCalled();
  });
});

describe('Command Handlers', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let connectionInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

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

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);

    // Trigger panel creation to initialize connection
    await vscode.commands.executeCommand('openhands.openTab');

    // Get the ConnectionManager instance
    const { ConnectionManager } = await import('../connection/ConnectionManager');
    connectionInstance = (ConnectionManager as any).mock.results[0]?.value;
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should handle startNewConversation command', async () => {
    await vscode.commands.executeCommand('openhands.startNewConversation');

    expect(connectionInstance.startNewConversation).toHaveBeenCalled();
  });

  it('should handle configure command successfully', async () => {
    (vscode.window.showInputBox as Mock)
      .mockResolvedValueOnce('http://localhost:3000') // serverUrl
      .mockResolvedValueOnce('default-llm') // usageId
      .mockResolvedValueOnce('claude-3-5-sonnet') // llmModel
      .mockResolvedValueOnce('') // llmBaseUrl
      .mockResolvedValueOnce('test-api-key') // llmApiKey
      .mockResolvedValueOnce('50') // maxIterations
      .mockResolvedValueOnce(''); // sessionApiKey

    (vscode.window.showQuickPick as Mock)
      .mockResolvedValueOnce('No') // enableSecurityAnalyzer
      .mockResolvedValueOnce('never'); // policy

    await vscode.commands.executeCommand('openhands.configure');

    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('OpenHands settings updated.');
  });

  it('should handle reconnect command', async () => {
    await vscode.commands.executeCommand('openhands.reconnect');

    expect(connectionInstance.reconnect).toHaveBeenCalled();
  });

  it('should handle pauseCurrentRun command', async () => {
    await vscode.commands.executeCommand('openhands.pauseCurrentRun');

    expect(connectionInstance.pause).toHaveBeenCalled();
  });

  it('should handle resumeCurrentRun command', async () => {
    await vscode.commands.executeCommand('openhands.resumeCurrentRun');

    expect(connectionInstance.resume).toHaveBeenCalled();
  });

  it('should handle configure command cancellation gracefully', async () => {
    (vscode.window.showInputBox as Mock).mockResolvedValueOnce(undefined); // User cancels

    await vscode.commands.executeCommand('openhands.configure');

    // Should not show success message if cancelled
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('should initialize panel if not present before command execution', async () => {
    // Dispose panel to test initialization
    if (mockPanel._disposeHandler) {
      mockPanel._disposeHandler();
    }

    // Clear mock to track new calls
    vi.clearAllMocks();

    await vscode.commands.executeCommand('openhands.reconnect');

    // Should create panel before executing reconnect
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
    expect(connectionInstance.reconnect).toHaveBeenCalled();
  });
});

describe('Message Routing', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let messageHandler: Function;
  let connectionInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => {
          messageHandler = handler;
          return { dispose: vi.fn() };
        }),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const { ConnectionManager } = await import('../connection/ConnectionManager');
    connectionInstance = (ConnectionManager as any).mock.results[0]?.value;
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should route "send" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'send', text: 'Hello, agent!' });

    expect(connectionInstance.sendUserMessage).toHaveBeenCalledWith('Hello, agent!');
  });

  it('should route "command:reconnect" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'command', command: 'reconnect' });

    expect(connectionInstance.reconnect).toHaveBeenCalled();
  });

  it('should route "command:pause" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'command', command: 'pause' });

    expect(connectionInstance.pause).toHaveBeenCalled();
  });

  it('should route "command:startNewConversation" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'command', command: 'startNewConversation' });

    expect(connectionInstance.startNewConversation).toHaveBeenCalled();
  });

  it('should route "command:approveAction" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'command', command: 'approveAction' });

    expect(connectionInstance.approveAction).toHaveBeenCalled();
  });

  it('should route "command:rejectAction" messages to ConnectionManager', async () => {
    await messageHandler({ type: 'command', command: 'rejectAction', reason: 'Too risky' });

    expect(connectionInstance.rejectAction).toHaveBeenCalledWith('Too risky');
  });

  it('should handle "getConfig" messages by posting config to webview', async () => {
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', 'http://localhost:3000');

    await messageHandler({ type: 'getConfig' });

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      serverUrl: 'http://localhost:3000',
    });
  });
});

describe('Event Streaming', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let connectionCallbacks: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

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

    // Capture ConnectionManager callbacks
    const { ConnectionManager } = await import('../connection/ConnectionManager');
    (ConnectionManager as any).mockImplementation(function (this: any, serverUrl: string, callbacks: any) {
      connectionCallbacks = callbacks;
      this.serverUrl = serverUrl;
      this.callbacks = callbacks;
      this.settings = null;
      this.conversationId = null;
      this.status = 'disconnected';
      this.startNewConversation = vi.fn();
      this.sendUserMessage = vi.fn();
      this.reconnect = vi.fn();
      this.pause = vi.fn();
      this.resume = vi.fn();
      this.approveAction = vi.fn();
      this.rejectAction = vi.fn();
      this.disconnect = vi.fn();
      this.setSettings = vi.fn();
      this.setServerUrl = vi.fn();
      this.restoreConversation = vi.fn();
      this.getConversationId = vi.fn();
      this.getStatus = vi.fn();
      return this;
    });

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should forward onEvent callbacks to webview', () => {
    const testEvent = { type: 'agent_message', message: 'Test event' };

    connectionCallbacks.onEvent(testEvent);

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'event',
      event: testEvent,
    });
  });

  it('should forward onStatus callbacks to webview', () => {
    connectionCallbacks.onStatus('online');

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'status',
      status: 'online',
    });
  });

  it('should forward onError callbacks to webview', () => {
    connectionCallbacks.onError(new Error('Test error'));

    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'error',
      error: 'Error: Test error',
    });
  });

  it('should update workspace state on conversation ID change', () => {
    connectionCallbacks.onConversationId('new-conversation-id');

    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'openhands.conversationId',
      'new-conversation-id'
    );
  });
});

describe('Bash Integration', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let mockTerminal: any;
  let bashCallbacks: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    mockTerminal = {
      sendText: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };

    (vscode.window.createTerminal as Mock).mockReturnValue(mockTerminal);

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

    // Enable bash events
    (vscode as any).__getMockConfigValues().set('openhands.bashEvents.enabled', true);

    // Capture BashEventsClient callbacks
    const { BashEventsClient } = await import('../terminal/BashEventsClient');
    (BashEventsClient as any).mockImplementation(function (this: any, serverUrl: string, callbacks: any, sessionApiKey?: string) {
      bashCallbacks = callbacks;
      this.serverUrl = serverUrl;
      this.callbacks = callbacks;
      this.sessionApiKey = sessionApiKey;
      this.status = 'disconnected';
      this.connect = vi.fn();
      this.disconnect = vi.fn();
      this.setServerUrl = vi.fn();
      this.setSessionApiKey = vi.fn();
      this.reconnect = vi.fn();
      this.injectEvent = vi.fn((event: any) => callbacks.onEvent(event));
      this.getStatus = vi.fn();
      return this;
    });

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should create terminal on first bash event', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    bashCallbacks.onEvent({ type: 'bash_command', command: 'ls' });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({ name: 'OpenHands' });
    expect(mockTerminal.show).toHaveBeenCalledWith(true);
  });

  it('should reuse terminal for subsequent bash events', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    bashCallbacks.onEvent({ type: 'bash_command', command: 'ls' });
    bashCallbacks.onEvent({ type: 'bash_command', command: 'pwd' });

    // Should only create terminal once
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);
  });

  it('should write bash_command events to terminal', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    bashCallbacks.onEvent({ type: 'bash_command', command: 'echo "hello"' });

    expect(mockTerminal.sendText).toHaveBeenCalledWith('$ echo "hello"', false);
    expect(mockTerminal.sendText).toHaveBeenCalledWith('');
  });

  it('should write bash_output events to terminal', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    // Trigger terminal creation
    bashCallbacks.onEvent({ type: 'bash_command', command: 'ls' });
    vi.clearAllMocks();

    bashCallbacks.onEvent({
      type: 'bash_output',
      stdout: 'file1.txt\n',
      stderr: '',
    });

    expect(mockTerminal.sendText).toHaveBeenCalledWith('file1.txt\n', false);
  });

  it('should dispose terminal when bash events disabled', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    // Trigger terminal creation
    bashCallbacks.onEvent({ type: 'bash_command', command: 'ls' });

    // Disable bash events
    (vscode as any).__getMockConfigValues().set('openhands.bashEvents.enabled', false);
    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.bashEvents.enabled',
    });

    // Give async operations time to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockTerminal.dispose).toHaveBeenCalled();
  });
});

describe('Settings Updates', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let connectionInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

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

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const { ConnectionManager } = await import('../connection/ConnectionManager');
    connectionInstance = (ConnectionManager as any).mock.results[0]?.value;
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should propagate server URL changes to ConnectionManager', async () => {
    (vscode as any).__getMockConfigValues().set('openhands.serverUrl', 'http://newserver:4000');

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.serverUrl',
    });

    // Give async operations time to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(connectionInstance.setServerUrl).toHaveBeenCalledWith('http://newserver:4000');
  });

  it('should update webview when settings change via configure command', async () => {
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
    });
  });

  it('should apply settings to ConnectionManager after configuration', async () => {
    (vscode.window.showInputBox as Mock)
      .mockResolvedValueOnce('http://localhost:3000')
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

    expect(connectionInstance.setSettings).toHaveBeenCalled();
  });

  it('should handle bash events toggle via configuration change', async () => {
    // Initially disabled, enable it
    (vscode as any).__getMockConfigValues().set('openhands.bashEvents.enabled', true);

    (vscode as any).__triggerConfigChange({
      affectsConfiguration: (key: string) => key === 'openhands.bashEvents.enabled',
    });

    // Give async operations time to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    const { BashEventsClient } = await import('../terminal/BashEventsClient');
    expect(BashEventsClient).toHaveBeenCalled();
  });
});

describe('Panel Lifecycle', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => {
        mockPanel._disposeHandler = handler;
        return { dispose: vi.fn() };
      }),
      reveal: vi.fn(),
      _disposeHandler: null as Function | null,
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should register dispose listener on panel creation', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    expect(mockPanel.onDidDispose).toHaveBeenCalled();
  });

  it('should cleanup panel reference on disposal', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    // Trigger dispose
    if (mockPanel._disposeHandler) {
      mockPanel._disposeHandler();
    }

    // Clear mocks to track new panel creation
    vi.clearAllMocks();

    // Should create new panel on next openTab
    await vscode.commands.executeCommand('openhands.openTab');
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
  });

  it('should cleanup on extension deactivate', async () => {
    // Arrange: activate and create a connection by opening the tab
    await vscode.commands.executeCommand('openhands.openTab');
    const { __getLastInstance } = await import('../connection/ConnectionManager');
    const connectionInstance = __getLastInstance();
    expect(connectionInstance).toBeDefined();

    // Act: deactivate the extension
    extension.deactivate();

    // Assert: ensure cleanup methods were called
    expect(connectionInstance.disconnect).toHaveBeenCalled();
  });
});

describe('Workspace State', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let connectionInstance: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

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

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn((key: string) => {
          if (key === 'openhands.conversationId') {
            return 'saved-conversation-id';
          }
          return undefined;
        }),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.openTab');

    const { ConnectionManager } = await import('../connection/ConnectionManager');
    connectionInstance = (ConnectionManager as any).mock.results[0]?.value;
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should persist conversation ID to workspace state', async () => {
    // Simulate conversation ID callback
    connectionInstance.callbacks.onConversationId('new-conv-123');

    expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
      'openhands.conversationId',
      'new-conv-123'
    );
  });

  it('should restore conversation ID from workspace state on initialization', async () => {
    expect(connectionInstance.restoreConversation).toHaveBeenCalledWith('saved-conversation-id');
  });
});

describe('E2E Support', () => {
  let mockContext: any;
  let extension: any;
  let mockPanel: any;
  let messageHandler: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();

    mockPanel = {
      webview: {
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn((handler: Function) => {
          messageHandler = handler;
          return { dispose: vi.fn() };
        }),
        asWebviewUri: vi.fn((uri: any) => uri),
        cspSource: 'vscode-webview:',
      },
      onDidDispose: vi.fn((handler: Function) => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
    };

    (vscode.window.createWebviewPanel as Mock).mockReturnValue(mockPanel);

    // Enable bash events for testing
    (vscode as any).__getMockConfigValues().set('openhands.bashEvents.enabled', true);

    mockContext = {
      subscriptions: [],
      extensionUri: { fsPath: '/test/extension' },
      workspaceState: {
        get: vi.fn(),
        update: vi.fn(),
      },
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
      },
    };

    extension = await import('../extension');
    await extension.activate(mockContext);
  });

  afterEach(() => {
    if (extension?.deactivate) {
      extension.deactivate();
    }
  });

  it('should return diagnostics via _diagnostics command', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    const diag = await vscode.commands.executeCommand('openhands._diagnostics');

    expect(diag).toMatchObject({
      hasPanel: true,
      hasConnection: true,
      serverUrl: expect.any(String),
      bashEvents: expect.objectContaining({
        enabled: expect.any(Boolean),
      }),
    });
  });

  it('should send test events via _sendTestEvent command', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    const testEvent = { type: 'test_event', data: 'test' };
    const result = await vscode.commands.executeCommand('openhands._sendTestEvent', testEvent);

    expect(result).toEqual({ sent: true });
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'event',
      event: testEvent,
    });
  });

  it('should handle bash event injection via _injectBashEvent command', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    const bashEvent = { type: 'bash_command', command: 'test' };
    const result = await vscode.commands.executeCommand('openhands._injectBashEvent', bashEvent);

    expect(result).toMatchObject({ injected: true });
  });

  it('should query bash events via _queryBashEvents command', async () => {
    await vscode.commands.executeCommand('openhands.openTab');

    // Inject some events
    await vscode.commands.executeCommand('openhands._injectBashEvent', {
      type: 'bash_command',
      command: 'ls',
    });

    const result = await vscode.commands.executeCommand('openhands._queryBashEvents');

    expect(result).toMatchObject({
      count: expect.any(Number),
      eventTypes: expect.any(Array),
      events: expect.any(Array),
    });
  });
});
