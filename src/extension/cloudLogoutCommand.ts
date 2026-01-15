import * as vscode from 'vscode';
import { SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import {
  getServerSessionApiKeySecretKey,
  LEGACY_SESSION_API_KEY_SECRET_KEY,
} from '../auth/serverSessionApiKeys';

type Output = Pick<vscode.OutputChannel, 'appendLine'>;

function renderServerLabel(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return url.hostname + (url.port ? `:${url.port}` : '');
  } catch {
    return serverUrl;
  }
}

function trimOrEmpty(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function registerCloudLogoutCommand(options: {
  context: vscode.ExtensionContext;
  getOutputChannel: () => Output | undefined;
}): vscode.Disposable {
  const { context } = options;

  return vscode.commands.registerCommand('openhands.cloudLogout', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();

    const currentServerUrl = typeof settings.serverUrl === 'string' ? settings.serverUrl.trim() : '';
    if (!currentServerUrl) {
      void vscode.window.showErrorMessage('OpenHands: Select a remote server before logging out.');
      return;
    }

    const keyInfo = getServerSessionApiKeySecretKey(currentServerUrl);
    if (!keyInfo.ok) {
      void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
      return;
    }

    const serverLabel = renderServerLabel(keyInfo.normalizedServerUrl);
    const confirm = await vscode.window.showWarningMessage(
      `OpenHands: Log out of ${serverLabel}? This will clear stored credentials for this server.`,
      { modal: true },
      'Log out',
    );
    if (confirm !== 'Log out') return;

    const output = options.getOutputChannel();

    let serverTokenRaw: string | undefined;
    try {
      serverTokenRaw = await context.secrets.get(keyInfo.secretKey);
    } catch {
      serverTokenRaw = undefined;
    }
    const serverToken = trimOrEmpty(serverTokenRaw);

    await context.secrets.delete(keyInfo.secretKey);

    let legacyRaw: string | undefined;
    try {
      legacyRaw = await context.secrets.get(LEGACY_SESSION_API_KEY_SECRET_KEY);
    } catch {
      legacyRaw = undefined;
    }
    const legacyValue = trimOrEmpty(legacyRaw);
    const shouldClearLegacy = !legacyValue || (!!serverToken && legacyValue === serverToken);
    if (shouldClearLegacy) {
      await context.secrets.delete(LEGACY_SESSION_API_KEY_SECRET_KEY);
    }

    output?.appendLine(`[auth] Cleared session API key for ${keyInfo.normalizedServerUrl}.`);
    if (!shouldClearLegacy && legacyValue) {
      output?.appendLine('[auth] Legacy openhands.sessionApiKey was not cleared (different value already set).');
    }

    void vscode.window.showInformationMessage(`OpenHands: Logged out of ${serverLabel}.`);
  });
}

