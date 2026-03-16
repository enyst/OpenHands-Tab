import { EventEmitter } from 'events';
import * as fsSync from 'node:fs';
import * as path from 'path';
import { expect, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';

export const defaultMockSettings = {
  serverUrl: 'http://localhost:3000',
  llm: {
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
    runtimeSessionApiKey: 'test-session-key',
  },
};

let mockSettings: any = structuredClone(defaultMockSettings);
let registeredSecretValues: string[] = [];
let lastConversation: any = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeSettingsPartial = (current: Record<string, unknown>, partial: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    const existing = next[key];
    if (isRecord(existing) && isRecord(value)) {
      next[key] = { ...existing, ...value };
      continue;
    }
    next[key] = value;
  }
  return next;
};

export const startDeviceAuthorizationMock = vi.fn();
export const pollDeviceTokenMock = vi.fn();
export const bootstrapCloudRemoteConversationMock = vi.fn(async () => ({
  saasServerUrl: 'https://app.all-hands.dev',
  nestedServerUrl: 'http://localhost:3000',
  conversationId: 'cloud-conversation-id',
  runtimeSessionApiKey: 'runtime-token',
}));

vi.mock('../auth/deviceFlow', () => ({
  startDeviceAuthorization: (...args: any[]) => startDeviceAuthorizationMock(...args),
  pollDeviceToken: (...args: any[]) => pollDeviceTokenMock(...args),
}));

vi.mock('../cloud/cloudRemoteBootstrap', () => ({
  bootstrapCloudRemoteConversation: (...args: any[]) => bootstrapCloudRemoteConversationMock(...args),
}));

vi.mock('../settings/SettingsManager', () => ({
  SettingsManager: vi.fn(function (this: any) {
    this.get = vi.fn(async () => mockSettings);
    this.update = vi.fn(async (partial: any) => {
      if (isRecord(partial)) {
        mockSettings = mergeSettingsPartial(mockSettings as Record<string, unknown>, partial);
        return;
      }
      mockSettings = partial;
    });
    return this;
  }),
}));

vi.mock('../settings/VscodeSettingsAdapter', () => ({
  VscodeSettingsAdapter: vi.fn(function (this: any) {
    return this;
  }),
}));

vi.mock('@smolpaws/agent-sdk', () => {
  class StubTool {
    name: string;
    description = '';
    schema: Record<string, unknown> = {};

    constructor(name: string) {
      this.name = name;
    }
  }

  class AgentContext {
    static lastParams: any = null;

    constructor(params?: any) {
      AgentContext.lastParams = params ?? null;
    }

    static __getLastParams() {
      return AgentContext.lastParams;
    }
  }

  class SecretRegistry {
    constructor(_storage?: unknown) {}

    set = vi.fn();

    getRegisteredValues = vi.fn(() => registeredSecretValues);
  }

  const Workspace = vi.fn((options: any = {}) => {
    if (options.kind === 'remote') {
      return {
        kind: 'remote',
        root: options.workingDir ?? options.workspaceRoot ?? 'workspace/project',
        serverUrl: options.serverUrl,
      };
    }
    if (options.kind === 'apple') {
      return {
        kind: 'apple',
        root: options.root ?? '/workspace',
        serverUrl: options.serverUrl ?? null,
      };
    }
    return {
      kind: 'local',
      root: options.root ?? '/workspace',
    };
  });

  const Conversation = vi.fn((options: any) => {
    const emitter = new EventEmitter() as any;
    emitter.mode = options?.workspace?.kind === 'remote' || options?.workspace?.kind === 'apple' || options?.serverUrl
      ? 'remote'
      : 'local';
    emitter.conversationId = options?.conversationId ?? null;
    emitter.status = 'offline';
    emitter.getConversationId = vi.fn(() => emitter.conversationId);
    emitter.getStatus = vi.fn(() => emitter.status);
    emitter.setSettings = vi.fn();
    emitter.restoreConversation = vi.fn((id: string) => {
      emitter.conversationId = id;
    });
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
    emitter.disconnect = vi.fn(() => {
      emitter.status = 'offline';
    });
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
    Workspace,
    loadSkillsFromDir: vi.fn(() => ({ repoSkills: new Map(), knowledgeSkills: new Map(), agentSkills: new Map() })),
    isBashCommand: vi.fn((event: any) => event?.type === 'BashCommand'),
    isBashOutput: vi.fn((event: any) => event?.type === 'BashOutput'),
    isBashExit: vi.fn((event: any) => event?.type === 'BashExit'),
    FileStore,
    isEvent: vi.fn((candidate: any) => !!candidate && typeof candidate === 'object' && typeof candidate.kind === 'string'),
    isMessageEvent: vi.fn((event: any) => event?.kind === 'MessageEvent' && !!event.llm_message && typeof event.llm_message === 'object'),
    isTextContent: vi.fn((content: any) => content?.type === 'text'),
    __getLastConversation: () => lastConversation,
    TerminalTool: vi.fn(() => new StubTool('terminal')),
    __getLastAgentContextParams: () => AgentContext.__getLastParams(),

    FileEditorTool: vi.fn(() => new StubTool('file_editor')),
    TaskTrackerTool: vi.fn(() => new StubTool('task_tracker')),
    GlobTool: vi.fn(() => new StubTool('glob')),
    GrepTool: vi.fn(() => new StubTool('grep')),
    BrowserTool: vi.fn(() => new StubTool('browser')),
    AskOracleTool: vi.fn(() => new StubTool('ask_oracle')),
    FinishTool: vi.fn(() => new StubTool('finish')),
  };
});

export function resetHarnessState(): void {
  vi.clearAllMocks();
  (vscode as any).__resetMocks();
  mockSettings = structuredClone(defaultMockSettings);
  registeredSecretValues = [];
  lastConversation = null;
}

export function getMockSettings(): any {
  return mockSettings;
}

export function setMockSettings(next: any): void {
  mockSettings = next;
}

export function setRegisteredSecretValues(values: string[]): void {
  registeredSecretValues = [...values];
}

export function createMockContext(): Partial<vscode.ExtensionContext> {
  return {
    subscriptions: [],
    extensionUri: { fsPath: '/test/extension' } as vscode.Uri,
    extensionMode: vscode.ExtensionMode.Production,
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

export const mockOpenHandsTerminalLog = (options: { capturePty?: boolean } = {}) => {
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
    onDidChangeVisibility: vi.fn((handler: Function) => {
      view._visibilityHandler = handler;
      return { dispose: vi.fn() };
    }),
    _messageHandler: null as Function | null,
    _disposeHandler: null as Function | null,
    _visibilityHandler: null as Function | null,
  };

  return view;
}

export async function resolveChatView(mockContext: any) {
  const provider = (vscode.window.registerWebviewViewProvider as Mock).mock.calls.find(
    (call) => call[0] === 'openhands.agent'
  )?.[1];
  expect(provider).toBeTruthy();

  const view = createMockWebviewView();
  const { Conversation } = await import('@smolpaws/agent-sdk');
  const beforeCalls = (Conversation as Mock).mock.calls.length;
  provider.resolveWebviewView(view);

  // ensureConversationAndConnection() is async and invoked without await
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((Conversation as Mock).mock.calls.length > beforeCalls) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if ((Conversation as Mock).mock.calls.length <= beforeCalls) {
    throw new Error('Timed out waiting for conversation initialization after resolving chat view');
  }

  return view;
}
