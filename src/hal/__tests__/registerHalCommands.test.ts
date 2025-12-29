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

import { registerHalCommands, type RegisterHalCommandsDeps } from '../registerHalCommands';

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

describe('registerHalCommands', () => {
  let mockContext: any;
  let mockSecretRegistry: SecretRegistry;
  let mockDeps: RegisterHalCommandsDeps;
  let registeredCommands: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    mockSettings = structuredClone(defaultMockSettings);
    registeredCommands = new Map();

    (vscode.commands.registerCommand as Mock).mockImplementation((name: string, callback: (...args: unknown[]) => unknown) => {
      registeredCommands.set(name, callback);
      return { dispose: vi.fn() };
    });

    mockContext = createMockContext();

    mockSecretRegistry = new SecretRegistry(mockContext.secrets);

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
      resolveGitContext: vi.fn().mockResolvedValue({ repoName: 'test-repo', branchName: 'main' }),
      summarizeWithLocalLlm: vi.fn().mockResolvedValue('Test summary'),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
  });

  it('registers the teleportToRemoteRuntime command', () => {
    const disposables = registerHalCommands(mockDeps);

    expect(disposables).toHaveLength(1);
    expect(registeredCommands.has('openhands._teleportToRemoteRuntime')).toBe(true);
  });

  it('returns disposables for all registered commands', () => {
    const disposables = registerHalCommands(mockDeps);

    expect(disposables).toHaveLength(1);
    disposables.forEach((d) => {
      expect(d).toHaveProperty('dispose');
    });
  });

  it('teleport command shows error when no server is available', async () => {
    const mockOutputChannel = {
      appendLine: vi.fn(),
    };
    mockDeps.getOutputChannel = vi.fn().mockReturnValue(mockOutputChannel);

    registerHalCommands(mockDeps);

    const teleportCommand = registeredCommands.get('openhands._teleportToRemoteRuntime');
    expect(teleportCommand).toBeDefined();

    await teleportCommand!();

    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('No server available')
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No server available');
  });
});
