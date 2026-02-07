import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';

import {
  createMockContext,
  defaultMockSettings,
  pollDeviceTokenMock,
  resetHarnessState,
  startDeviceAuthorizationMock,
} from './extension.test.harness';

describe('Extension Activation', () => {
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

  it('registers commands on activation', async () => {
    await extension.activate(mockContext);
    expect(vscode.commands.registerCommand).toHaveBeenCalled();
  });

  it('cloudLogin stores a per-server cloud API key', async () => {
    const secretStorage = new Map<string, string>();

    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));
    mockContext.secrets.store = vi.fn(async (key: string, value: string) => {
      secretStorage.set(key, value);
    });

    startDeviceAuthorizationMock.mockResolvedValue({
      deviceCode: 'dev',
      userCode: 'ABC-123',
      verificationUri: 'https://example.com/verify',
      verificationUriComplete: 'https://example.com/verify?user_code=ABC-123',
      intervalMs: 1000,
    });
    pollDeviceTokenMock.mockResolvedValue({ accessToken: 'server-token' });
    (vscode.env.openExternal as Mock).mockResolvedValue(true);
    (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.cloudLogin');

    const { getServerCloudApiKeySecretKey } = await import('../auth/serverCloudApiKeys');
    const keyInfo = getServerCloudApiKeySecretKey(defaultMockSettings.serverUrl);
    expect(keyInfo.ok).toBe(true);
    if (!keyInfo.ok) return;

    expect(secretStorage.get(keyInfo.secretKey)).toBe('server-token');
  });

  it('cloudLogout clears the per-server cloud API key', async () => {
    const secretStorage = new Map<string, string>();

    const { getServerCloudApiKeySecretKey } = await import('../auth/serverCloudApiKeys');
    const keyInfo = getServerCloudApiKeySecretKey(defaultMockSettings.serverUrl);
    expect(keyInfo.ok).toBe(true);
    if (!keyInfo.ok) return;

    secretStorage.set(keyInfo.secretKey, 'server-token');

    mockContext.secrets.get = vi.fn(async (key: string) => secretStorage.get(key));
    mockContext.secrets.delete = vi.fn(async (key: string) => {
      secretStorage.delete(key);
    });

    (vscode.window.showWarningMessage as Mock).mockResolvedValue('Log out');

    await extension.activate(mockContext);
    await vscode.commands.executeCommand('openhands.cloudLogout');

    expect(secretStorage.has(keyInfo.secretKey)).toBe(false);
  });

  it('does not create a conversation until the chat view resolves', async () => {
    const { __getLastConversation } = await import('@openhands/agent-sdk-ts');
    await extension.activate(mockContext);
    expect(__getLastConversation()).toBeNull();
  });

  it('does not auto-show the Output channel in production with minimal verbosity', async () => {
    mockContext.extensionMode = vscode.ExtensionMode.Production;

    const cfgValues = (vscode as any).__getMockConfigValues();
    cfgValues.set('openhands.logging.verbosity', 'minimal');
    cfgValues.set('openhands.agent.debug', false);
    cfgValues.set('openhands.devBridge.enabled', false);

    await extension.activate(mockContext);

    const created = (vscode.window.createOutputChannel as Mock).mock.results[0]?.value;
    expect(created?.show).not.toHaveBeenCalled();
  });

  it('auto-shows the Output channel in production when verbose output is enabled', async () => {
    mockContext.extensionMode = vscode.ExtensionMode.Production;

    const cfgValues = (vscode as any).__getMockConfigValues();
    cfgValues.set('openhands.logging.verbosity', 'verbose');
    cfgValues.set('openhands.agent.debug', false);
    cfgValues.set('openhands.devBridge.enabled', false);

    await extension.activate(mockContext);

    const created = (vscode.window.createOutputChannel as Mock).mock.results[0]?.value;
    expect(created?.show).toHaveBeenCalled();
    expect(created?.appendLine).toHaveBeenCalledWith('[OpenHands] Logging channel initialized');
  });

  it('toggles verbose output via command', async () => {
    mockContext.extensionMode = vscode.ExtensionMode.Production;

    const cfgValues = (vscode as any).__getMockConfigValues();
    cfgValues.set('openhands.logging.verbosity', 'minimal');
    cfgValues.set('openhands.agent.debug', false);
    cfgValues.set('openhands.devBridge.enabled', false);

    await extension.activate(mockContext);
    const created = (vscode.window.createOutputChannel as Mock).mock.results[0]?.value;
    expect(cfgValues.get('openhands.logging.verbosity')).toBe('minimal');
    expect(created?.show).not.toHaveBeenCalled();

    await vscode.commands.executeCommand('openhands.toggleVerboseOutput');
    expect(cfgValues.get('openhands.logging.verbosity')).toBe('verbose');
    expect(created?.show).toHaveBeenCalled();

    const showCalls = (created?.show as Mock).mock.calls.length;
    await vscode.commands.executeCommand('openhands.toggleVerboseOutput');
    expect(cfgValues.get('openhands.logging.verbosity')).toBe('minimal');
    expect((created?.show as Mock).mock.calls.length).toBe(showCalls);
  });
});
