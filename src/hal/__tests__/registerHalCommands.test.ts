import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { SecretRegistry } from '@openhands/agent-sdk-ts';

const defaultMockSettings = {
  serverUrl: '',
  servers: [],
  llm: {},
};

let mockSettings = structuredClone(defaultMockSettings);

vi.mock('../../settings/SettingsManager', () => ({
  SettingsManager: vi.fn(function (this: any) {
    this.get = vi.fn(async () => mockSettings);
    this.update = vi.fn(async (partial: any) => {
      mockSettings = { ...mockSettings, ...partial };
    });
    return this;
  }),
}));

vi.mock('../../settings/VscodeSettingsAdapter', () => ({
  VscodeSettingsAdapter: vi.fn(function (this: any) {
    return this;
  }),
}));

import { registerHalCommands, formatTeleportError, type RegisterHalCommandsDeps } from '../registerHalCommands';

function createMockContext(): Partial<vscode.ExtensionContext> {
  return {
    subscriptions: [],
    extensionUri: { fsPath: '/test/extension' } as vscode.Uri,
    workspaceState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } as any,
    globalState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(() => []),
      setKeysForSync: vi.fn(),
    } as any,
    secrets: {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    } as any,
  };
}

describe('formatTeleportError', () => {
  it('formats ECONNREFUSED errors', () => {
    expect(formatTeleportError('Error: connect ECONNREFUSED 127.0.0.1:3000')).toBe(
      'Server unreachable. Check if it is running.'
    );
  });

  it('formats connection refused errors', () => {
    expect(formatTeleportError('Connection refused by server')).toBe(
      'Server unreachable. Check if it is running.'
    );
  });

  it('formats timeout errors', () => {
    expect(formatTeleportError('Error: ETIMEDOUT')).toBe(
      'Connection timed out. Server may be down.'
    );
    expect(formatTeleportError('Request timed out after 30s')).toBe(
      'Connection timed out. Server may be down.'
    );
  });

  it('formats DNS resolution errors', () => {
    expect(formatTeleportError('Error: getaddrinfo ENOTFOUND example.com')).toBe(
      'Server not found. Check the URL.'
    );
  });

  it('formats network unreachable errors', () => {
    expect(formatTeleportError('Error: ENETUNREACH')).toBe(
      'Network unreachable. Check your connection.'
    );
  });

  it('formats SSL/TLS errors', () => {
    expect(formatTeleportError('SSL certificate problem')).toBe(
      'SSL/TLS error. Invalid certificate?'
    );
    expect(formatTeleportError('TLS handshake failed')).toBe(
      'SSL/TLS error. Invalid certificate?'
    );
  });

  it('formats connection reset errors', () => {
    expect(formatTeleportError('Error: ECONNRESET')).toBe(
      'Connection reset. Try again.'
    );
  });

  it('formats WebSocket errors', () => {
    expect(formatTeleportError('WebSocket connection failed')).toBe(
      'WebSocket failed. Server not accepting connections.'
    );
  });

  it('returns original error for unknown patterns', () => {
    const unknownError = 'Some unknown error occurred';
    expect(formatTeleportError(unknownError)).toBe(unknownError);
  });
});

describe('registerHalCommands', () => {
  let mockContext: any;
  let mockSecretRegistry: SecretRegistry;
  let mockDeps: RegisterHalCommandsDeps;
  let registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  let originalFetch: any;

  beforeEach(() => {
    mockSettings = structuredClone(defaultMockSettings);
    registeredCommands = new Map();

    (vscode.commands.registerCommand as Mock).mockImplementation((name: string, callback: (...args: unknown[]) => unknown) => {
      registeredCommands.set(name, callback);
      return { dispose: vi.fn() };
    });

    mockContext = createMockContext();

    mockSecretRegistry = new SecretRegistry(mockContext.secrets);

    originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    mockDeps = {
      context: mockContext,
      getChatView: vi.fn().mockReturnValue(undefined),
      getChatWebviewReady: vi.fn().mockReturnValue(false),
      iterConversationEventBacklog: vi.fn().mockReturnValue([]),
      sentTestEvents: [],
      ensureConversationAndConnection: vi.fn().mockResolvedValue(undefined),
      printedExitFor: new Map(),
      secretRegistry: mockSecretRegistry,
      getConversation: vi.fn().mockReturnValue(undefined),
      getOutputChannel: vi.fn().mockReturnValue(undefined),
      renderError: vi.fn((err: unknown) => String(err)),
      resolveGitContext: vi.fn().mockResolvedValue({ repoName: 'test-repo', branchName: 'main', remoteUrl: 'https://github.com/test/test-repo.git' }),
      summarizeWithLocalLlm: vi.fn().mockResolvedValue('Test summary'),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
    (globalThis as any).fetch = originalFetch;
  });

  it('registers the teleportToRemoteRuntime command', () => {
    const disposables = registerHalCommands(mockDeps);

    expect(disposables).toHaveLength(2);
    expect(registeredCommands.has('openhands._teleportToRemoteRuntime')).toBe(true);
    expect(registeredCommands.has('openhands._cancelTeleportToRemoteRuntime')).toBe(true);
  });

  it('returns disposables for all registered commands', () => {
    const disposables = registerHalCommands(mockDeps);

    expect(disposables).toHaveLength(2);
    disposables.forEach((d) => {
      expect(d).toHaveProperty('dispose');
    });
  });

  it('teleport command shows helpful error when no server is configured', async () => {
    const mockOutputChannel = {
      appendLine: vi.fn(),
    };
    mockDeps.getOutputChannel = vi.fn().mockReturnValue(mockOutputChannel);

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    expect(teleportCommand).toBeDefined();

    await teleportCommand!();

    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('No server configured')
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'No server configured. Add one in Server Selection.'
    );
  });

  it('teleport command posts halTeleportStarting message with server info', async () => {
    mockSettings = {
      serverUrl: '',
      servers: [{ url: 'https://example.com', label: 'My Server' }],
      llm: {},
    };

    const mockWebview = {
      postMessage: vi.fn().mockResolvedValue(true),
    };
    const mockChatView = {
      webview: mockWebview,
    };
    mockDeps.getChatView = vi.fn().mockReturnValue(mockChatView);
    mockDeps.getChatWebviewReady = vi.fn().mockReturnValue(true);

    // Make ensureConversationAndConnection throw to stop execution early
    mockDeps.ensureConversationAndConnection = vi.fn().mockRejectedValue(new Error('Test stop'));

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    await teleportCommand!();

    // Check that halTeleportStarting was posted with server info
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: 'halTeleportStarting',
      serverUrl: 'https://example.com',
      serverLabel: 'My Server',
    });
  });

  it('teleport command posts halTeleportFailed with serverUrl on error', async () => {
    mockSettings = {
      serverUrl: '',
      servers: [{ url: 'https://example.com' }],
      llm: {},
    };

    const mockWebview = {
      postMessage: vi.fn().mockResolvedValue(true),
    };
    const mockChatView = {
      webview: mockWebview,
    };
    mockDeps.getChatView = vi.fn().mockReturnValue(mockChatView);
    mockDeps.getChatWebviewReady = vi.fn().mockReturnValue(true);
    mockDeps.renderError = vi.fn().mockReturnValue('ECONNREFUSED');

    // Make ensureConversationAndConnection throw
    mockDeps.ensureConversationAndConnection = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    await teleportCommand!();

    // Check that halTeleportFailed was posted with formatted error and serverUrl
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: 'halTeleportFailed',
      error: 'Server unreachable. Check if it is running.',
      serverUrl: 'https://example.com',
    });
  });

  it('does NOT reject local action when connection fails', async () => {
    mockSettings = {
      serverUrl: '',
      servers: [{ url: 'https://example.com' }],
      llm: {},
    };

    const mockWebview = {
      postMessage: vi.fn().mockResolvedValue(true),
    };
    const mockChatView = {
      webview: mockWebview,
    };
    mockDeps.getChatView = vi.fn().mockReturnValue(mockChatView);
    mockDeps.getChatWebviewReady = vi.fn().mockReturnValue(true);

    const mockConversation = {
      rejectAction: vi.fn().mockResolvedValue(undefined),
      startNewConversation: vi.fn().mockResolvedValue(undefined),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockDeps.getConversation = vi.fn().mockReturnValue(mockConversation);

    // Make ensureConversationAndConnection throw - simulating connection failure
    mockDeps.ensureConversationAndConnection = vi.fn().mockRejectedValue(new Error('Connection failed'));

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    await teleportCommand!();

    // The local action should NOT be rejected because connection failed
    expect(mockConversation.rejectAction).not.toHaveBeenCalled();
  });

  it('posts halTeleportSuccess on successful teleport', async () => {
    mockSettings = {
      serverUrl: '',
      servers: [{ url: 'https://example.com', label: 'My Server' }],
      llm: {},
    };

    const mockWebview = {
      postMessage: vi.fn().mockResolvedValue(true),
    };
    const mockChatView = {
      webview: mockWebview,
    };
    mockDeps.getChatView = vi.fn().mockReturnValue(mockChatView);
    mockDeps.getChatWebviewReady = vi.fn().mockReturnValue(true);

    const localConversation = {
      rejectAction: vi.fn().mockResolvedValue(undefined),
    };
    const remoteConversation = {
      startNewConversation: vi.fn().mockResolvedValue(undefined),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      rejectAction: vi.fn().mockResolvedValue(undefined),
    };
    let connected = false;
    mockDeps.getConversation = vi.fn().mockImplementation(() => (connected ? remoteConversation : localConversation) as any);

    // Connection succeeds
    mockDeps.ensureConversationAndConnection = vi.fn().mockImplementation(async () => {
      connected = true;
    });

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    await teleportCommand!();

    // Check that halTeleportSuccess was posted
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: 'halTeleportSuccess',
      serverUrl: 'https://example.com',
      serverLabel: 'My Server',
    });

    // The local action SHOULD be rejected because connection succeeded
    expect(localConversation.rejectAction).toHaveBeenCalledWith('rejected because the user sent the conversation to the remote runtime');
    expect(remoteConversation.rejectAction).not.toHaveBeenCalled();
  });

  it('rejects local action only after successful connection', async () => {
    mockSettings = {
      serverUrl: '',
      servers: [{ url: 'https://example.com' }],
      llm: {},
    };

    const mockWebview = {
      postMessage: vi.fn().mockResolvedValue(true),
    };
    const mockChatView = {
      webview: mockWebview,
    };
    mockDeps.getChatView = vi.fn().mockReturnValue(mockChatView);
    mockDeps.getChatWebviewReady = vi.fn().mockReturnValue(true);

    const callOrder: string[] = [];

    const localConversation = {
      rejectAction: vi.fn().mockImplementation(() => {
        callOrder.push('rejectAction');
        return Promise.resolve(undefined);
      }),
    };
    const remoteConversation = {
      startNewConversation: vi.fn().mockImplementation(() => {
        callOrder.push('startNewConversation');
        return Promise.resolve(undefined);
      }),
      sendUserMessage: vi.fn().mockImplementation(() => {
        callOrder.push('sendUserMessage');
        return Promise.resolve(undefined);
      }),
    };
    let connected = false;
mockDeps.getConversation = vi.fn().mockImplementation(() => (connected ? remoteConversation : localConversation));

    mockDeps.ensureConversationAndConnection = vi.fn().mockImplementation(() => {
      callOrder.push('ensureConversationAndConnection');
      connected = true;
      return Promise.resolve(undefined);
    });

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    await teleportCommand!();

    // Verify the order: connection first, then reject, then new conversation
    expect(callOrder).toEqual([
      'ensureConversationAndConnection',
      'rejectAction',
      'startNewConversation',
      'sendUserMessage',
    ]);
  });
});
