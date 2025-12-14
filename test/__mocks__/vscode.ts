// Comprehensive mock for the 'vscode' module used by Vitest unit tests
// Combines capabilities needed by both legacy and new test suites
import { vi } from 'vitest';

// Internal registries for commands and listeners
const mockCommands = new Map<string, Function>();
const mockSubscriptions: Array<{ dispose: () => void }> = [];
const mockConfigListeners: Function[] = [];
const mockConfigValues = new Map<string, any>();
const mockWebviewViewProviders = new Map<string, any>();

// Workspace mock
export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue?: any) => (mockConfigValues.has(key) ? mockConfigValues.get(key) : defaultValue)),
    inspect: vi.fn(),
    update: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn((listener: Function) => {
    mockConfigListeners.push(listener);
    const disposable = { dispose: vi.fn() };
    mockSubscriptions.push(disposable);
    return disposable;
  }),
  workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
};

// Configuration target enums used by tests
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

// Window mock
const outputChannels: any[] = [];

export const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createOutputChannel: vi.fn((name: string) => {
    const channel = {
      name,
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };
    outputChannels.push(channel);
    return channel;
  }),
  createWebviewPanel: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  createTerminal: vi.fn(),
  onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  registerWebviewViewProvider: vi.fn((viewId: string, provider: any, _options?: any) => {
    mockWebviewViewProviders.set(viewId, provider);
    const disposable = { dispose: vi.fn(() => mockWebviewViewProviders.delete(viewId)) };
    mockSubscriptions.push(disposable);
    return disposable;
  }),
  registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  createTreeView: vi.fn(() => ({
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  })),
};

// Commands mock with register/execute behavior
export const commands = {
  registerCommand: vi.fn((name: string, handler: Function) => {
    mockCommands.set(name, handler);
    const disposable = { dispose: vi.fn(() => mockCommands.delete(name)) };
    mockSubscriptions.push(disposable);
    return disposable;
  }),
  executeCommand: vi.fn(async (name: string, ...args: any[]) => {
    const handler = mockCommands.get(name);
    if (handler) return await handler(...args);
  }),
};

// Uri helpers used by code and tests
export const Uri = {
  file: vi.fn((path: string) => ({ fsPath: path, scheme: 'file' })),
  parse: vi.fn((uri: string) => ({ fsPath: uri, scheme: 'file' })),
  joinPath: vi.fn((...args: any[]) => ({
    toString: () => args.join('/'),
    fsPath: args.join('/'),
  })),
};

// ViewColumn used by extension.openTab
export const ViewColumn = {
  Beside: 2,
};

// Tree view related mocks used by OpenHandsViewProvider
export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export class ThemeIcon {
  id: string;
  constructor(id: string) { this.id = id; }
}

export class EventEmitter<T> {
  private listeners: Array<(e: T) => any> = [];
  event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return { dispose: vi.fn() };
  };
  fire(e: T) { this.listeners.forEach(l => l(e)); }
  dispose() { this.listeners = []; }
}

export class TreeItem {
  label: string;
  collapsibleState: number;
  iconPath: any;
  command: any;
  constructor(label: string, collapsibleState: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export interface Command {
  command: string;
  title: string;
  arguments?: any[];
}

export interface ProviderResult<T> extends Promise<T> {}

export interface TreeDataProvider<T> {
  getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
  getChildren(element?: T): ProviderResult<T[]>;
}

// Utilities for tests to reset state
export function __resetMocks() {
  mockCommands.clear();
  mockSubscriptions.length = 0;
  mockConfigListeners.length = 0;
  mockConfigValues.clear();
  mockWebviewViewProviders.clear();
  // Reset common spies to default implementations
  ;(workspace.getConfiguration as any).mockClear();
  ;(workspace.onDidChangeConfiguration as any).mockClear();
  ;(window.showInformationMessage as any).mockClear();
  ;(window.showErrorMessage as any).mockClear();
  ;(window.showWarningMessage as any).mockClear();
  ;(window.createOutputChannel as any).mockClear();
  ;(window.createWebviewPanel as any).mockClear();
  ;(window.showInputBox as any).mockClear();
  ;(window.showQuickPick as any).mockClear();
  ;(window.createTerminal as any).mockClear();
  ;(window.createTreeView as any).mockClear();
  ;(window.registerWebviewViewProvider as any).mockClear();
  ;(commands.registerCommand as any).mockClear();
  ;(commands.executeCommand as any).mockClear();
}

// Expose helpers for tests that expect them
export function __getMockConfigValues() { return mockConfigValues; }
export function __getMockWebviewViewProviders() { return mockWebviewViewProviders; }

// Helper to manually trigger configuration change listeners (if needed by tests)
export function __triggerConfigChange(e: any) {
  mockConfigListeners.forEach((listener) => listener(e));
}
