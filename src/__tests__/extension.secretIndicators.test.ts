import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  defaultMockSettings,
  resetHarnessState,
} from './extension.test.harness';

describe('Secret indicator sync', () => {
  let mockContext: any;
  let extension: any;

  beforeEach(async () => {
    resetHarnessState();
    mockContext = createMockContext();
    extension = await import('../extension');
  });

  afterEach(() => {
    extension?.deactivate?.();
  });

  it('writes a non-secret status marker for runtimeSessionApiKey', async () => {
    const secretStorage = new Map<string, string>();
    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));

    const { getServerRuntimeSessionApiKeySecretKey } = await import('../auth/serverRuntimeSessionApiKeys');
    const keyInfo = getServerRuntimeSessionApiKeySecretKey(defaultMockSettings.serverUrl);
    expect(keyInfo.ok).toBe(true);
    if (!keyInfo.ok) return;
    secretStorage.set(keyInfo.secretKey, 'runtime-token');

    await extension.activate(mockContext);

    const cfg = vscode.workspace.getConfiguration();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((cfg.update as Mock).mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.runtimeSessionApiKey', '✓ set', vscode.ConfigurationTarget.Global);
    expect(cfg.update).not.toHaveBeenCalledWith(
      'openhands.secrets.runtimeSessionApiKey',
      'runtime-token',
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
      await new Promise((resolve) => setTimeout(resolve, 0));
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
      await new Promise((resolve) => setTimeout(resolve, 0));
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(cfg.update).toHaveBeenCalledWith('openhands.secrets.openaiApiKey', '✓ set', vscode.ConfigurationTarget.Global);
  });
});
