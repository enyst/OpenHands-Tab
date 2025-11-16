import { vi } from 'vitest';

/**
 * Mock implementation of the vscode module for unit tests
 * This provides a stable mock that can be imported and used across tests
 */

export const mockCommands = new Map<string, Function>();
export const mockSubscriptions: any[] = [];
export const mockSecrets = new Map<string, string>();
export const mockWorkspaceState = new Map<string, any>();
export const mockGlobalState = new Map<string, any>();
export const mockConfigValues = new Map<string, any>();
export const mockConfigListeners: Function[] = [];

export const window = {
  createWebviewPanel: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createTerminal: vi.fn(),
};

export const commands = {
  registerCommand: vi.fn((name: string, handler: Function) => {
    mockCommands.set(name, handler);
    const disposable = { dispose: vi.fn() };
    mockSubscriptions.push(disposable);
    return disposable;
  }),
  executeCommand: vi.fn(async (name: string, ...args: any[]) => {
    const handler = mockCommands.get(name);
    if (handler) {
      return await handler(...args);
    }
  }),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: any) => {
      return mockConfigValues.get(key) ?? defaultValue;
    }),
  })),
  onDidChangeConfiguration: vi.fn((listener: Function) => {
    mockConfigListeners.push(listener);
    const disposable = { dispose: vi.fn() };
    mockSubscriptions.push(disposable);
    return disposable;
  }),
  workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
};

export const Uri = {
  joinPath: vi.fn((...args: any[]) => ({
    toString: () => args.join('/'),
    fsPath: args.join('/'),
  })),
};

export const ViewColumn = {
  Beside: 2,
};

// Helper methods for tests
export function __resetMocks() {
  mockCommands.clear();
  mockSubscriptions.length = 0;
  mockSecrets.clear();
  mockWorkspaceState.clear();
  mockGlobalState.clear();
  mockConfigValues.clear();
  mockConfigListeners.length = 0;
}

export function __getMockCommands() {
  return mockCommands;
}

export function __getMockSubscriptions() {
  return mockSubscriptions;
}

export function __getMockSecrets() {
  return mockSecrets;
}

export function __getMockWorkspaceState() {
  return mockWorkspaceState;
}

export function __getMockConfigValues() {
  return mockConfigValues;
}

export function __triggerConfigChange(e: any) {
  mockConfigListeners.forEach(listener => listener(e));
}
