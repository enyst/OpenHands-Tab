import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createWebviewMessageHandler } from '../createWebviewMessageHandler';

describe('createWebviewMessageHandler (servers persistence)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (vscode as any).__resetMocks();
  });

  it('persists add/remove server changes to global settings', async () => {
    const globalValues = new Map<string, unknown>();
    const workspaceValues = new Map<string, unknown>();
    const workspaceFolderValues = new Map<string, unknown>();

    // Simulate VS Code precedence: workspace-folder overrides workspace overrides global.
    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (workspaceFolderValues.has(key)) return workspaceFolderValues.get(key);
        if (workspaceValues.has(key)) return workspaceValues.get(key);
        if (globalValues.has(key)) return globalValues.get(key);
        return defaultValue;
      }),
      inspect: vi.fn((key: string) => ({
        globalValue: globalValues.get(key),
        workspaceValue: workspaceValues.get(key),
        workspaceFolderValue: workspaceFolderValues.get(key),
      })),
      update: vi.fn(async (key: string, value: unknown, target: number) => {
        if (target === (vscode.ConfigurationTarget as any).Global) {
          globalValues.set(key, value);
        } else if (target === (vscode.ConfigurationTarget as any).Workspace) {
          workspaceValues.set(key, value);
        } else if (target === (vscode.ConfigurationTarget as any).WorkspaceFolder) {
          workspaceFolderValues.set(key, value);
        } else {
          throw new Error(`Unexpected configuration target: ${String(target)}`);
        }
      }),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    globalValues.set('openhands.servers', [{ url: 'http://old.example:3000', label: 'Old' }]);
    globalValues.set('openhands.serverUrl', 'http://old.example:3000');

    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const hostPostMessage = vi.fn(async () => true);

    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage: hostPostMessage },
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({ type: 'addServer', server: { url: 'http://new.example:3000', label: 'New' } });
    await handler({ type: 'removeServer', url: 'http://old.example:3000' });

    expect(globalValues.get('openhands.servers')).toEqual([{ url: 'http://new.example:3000', label: 'New' }]);
    expect(globalValues.get('openhands.serverUrl')).toBe('');
  });

  it('normalizes server URLs on add/select', async () => {
    const globalValues = new Map<string, unknown>();
    const workspaceValues = new Map<string, unknown>();
    const workspaceFolderValues = new Map<string, unknown>();

    const cfg = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (workspaceFolderValues.has(key)) return workspaceFolderValues.get(key);
        if (workspaceValues.has(key)) return workspaceValues.get(key);
        if (globalValues.has(key)) return globalValues.get(key);
        return defaultValue;
      }),
      inspect: vi.fn((key: string) => ({
        globalValue: globalValues.get(key),
        workspaceValue: workspaceValues.get(key),
        workspaceFolderValue: workspaceFolderValues.get(key),
      })),
      update: vi.fn(async (key: string, value: unknown, target: number) => {
        if (target === (vscode.ConfigurationTarget as any).Global) {
          globalValues.set(key, value);
        } else if (target === (vscode.ConfigurationTarget as any).Workspace) {
          workspaceValues.set(key, value);
        } else if (target === (vscode.ConfigurationTarget as any).WorkspaceFolder) {
          workspaceFolderValues.set(key, value);
        } else {
          throw new Error(`Unexpected configuration target: ${String(target)}`);
        }
      }),
    };

    (vscode.workspace.getConfiguration as any).mockImplementation(() => cfg);

    const context = {
      secrets: {
        get: vi.fn(async () => undefined),
        store: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
      },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    const hostPostMessage = vi.fn(async () => true);
    const handler = createWebviewMessageHandler({
      context,
      host: { postMessage: hostPostMessage },
      getQueuedUserEditNotes: () => [],
      clearQueuedUserEditNotes: () => {},
      getConversation: () => undefined,
      getConversationMode: () => 'local',
      getConversationStoreRoot: () => undefined,
      resolveConversationStoreRoot: async () => '/tmp/openhands-conversations',
      setWebviewReadyState: () => undefined,
      setLastKnownLlmLabel: () => undefined,
      getLastKnownLlmLabel: () => null,
      flushConversationEventBacklog: () => undefined,
      onRenderedEventsResponse: () => undefined,
      onUiStateResponse: () => undefined,
      onHalStateResponse: () => undefined,
      isDevBridgeEnabled: () => false,
      getOutputChannel: () => undefined,
      fileLog: () => undefined,
    });

    await handler({ type: 'addServer', server: { url: 'localhost:3000' } });
    expect(globalValues.get('openhands.servers')).toEqual([{ url: 'http://localhost:3000' }]);

    await handler({ type: 'selectServer', url: 'http:localhost:3000' });
    expect(globalValues.get('openhands.serverUrl')).toBe('http://localhost:3000');
    expect(globalValues.get('openhands.servers')).toEqual([{ url: 'http://localhost:3000' }]);
  });
});
