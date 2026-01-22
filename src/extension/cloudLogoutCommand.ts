import * as vscode from 'vscode';
import { SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import {
  getServerCloudApiKeySecretKey,
} from '../auth/serverCloudApiKeys';

type Output = Pick<vscode.OutputChannel, 'appendLine'>;

function renderServerLabel(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    return url.hostname + (url.port ? `:${url.port}` : '');
  } catch {
    return serverUrl;
  }
}

export function registerCloudLogoutCommand(options: {
  context: vscode.ExtensionContext;
  getOutputChannel: () => Output | undefined;
}): vscode.Disposable {
  const { context } = options;

  return vscode.commands.registerCommand('openhands.cloudLogout', async () => {
    const extensionMode = vscode.ExtensionMode;
    const isTestMode =
      extensionMode?.Test !== undefined &&
      context.extensionMode === extensionMode.Test;
    const isE2eMode = isTestMode && process.env.E2E_CLOUD_LOGIN === '1';

    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();

    const currentServerUrl = typeof settings.serverUrl === 'string' ? settings.serverUrl.trim() : '';
    if (!currentServerUrl) {
      void vscode.window.showErrorMessage('OpenHands: Select a remote server before logging out.');
      return;
    }

    const keyInfo = getServerCloudApiKeySecretKey(currentServerUrl);
    if (!keyInfo.ok) {
      void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
      return;
    }

    const serverLabel = renderServerLabel(keyInfo.normalizedServerUrl);
    const confirm = isE2eMode
      ? 'Log out'
      : await vscode.window.showWarningMessage(
        `OpenHands: Log out of ${serverLabel}? This will clear stored credentials for this server.`,
        { modal: true },
        'Log out',
      );
    if (confirm !== 'Log out') return;

    const output = options.getOutputChannel();

    await context.secrets.delete(keyInfo.secretKey);

    output?.appendLine(`[auth] Cleared cloud API key for ${keyInfo.normalizedServerUrl}.`);

    void vscode.window.showInformationMessage(`OpenHands: Logged out of ${serverLabel}.`);
  });
}
