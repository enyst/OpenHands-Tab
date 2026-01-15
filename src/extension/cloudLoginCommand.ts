import * as vscode from 'vscode';
import { SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { startDeviceAuthorization, pollDeviceToken, type HttpClientLike } from '../auth/deviceFlow';
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

export function registerCloudLoginCommand(options: {
  context: vscode.ExtensionContext;
  getOutputChannel: () => Output | undefined;
  onLoginCompleted?: (params: { normalizedServerUrl: string }) => void;
}): vscode.Disposable {
  const { context } = options;

  return vscode.commands.registerCommand('openhands.cloudLogin', async () => {
    const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
    const settings = await settingsMgr.get();

    const currentServerUrl = typeof settings.serverUrl === 'string' ? settings.serverUrl.trim() : '';
    if (!currentServerUrl) {
      void vscode.window.showErrorMessage('OpenHands: Select a remote server before logging in.');
      return;
    }

    const keyInfo = getServerSessionApiKeySecretKey(currentServerUrl);
    if (!keyInfo.ok) {
      void vscode.window.showErrorMessage(`OpenHands: Invalid server URL: ${keyInfo.error}`);
      return;
    }

    const output = options.getOutputChannel();
    const serverLabel = renderServerLabel(keyInfo.normalizedServerUrl);

    const controller = new AbortController();

    let token: string;
    try {
      token = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          cancellable: true,
          title: `OpenHands: Login to ${serverLabel}`,
        },
        async (progress, cancelToken) => {
          cancelToken.onCancellationRequested(() => controller.abort());

          const http: HttpClientLike = async (url, init) =>
            fetch(url, {
              method: init.method,
              headers: init.headers,
              body: init.body,
              signal: init.signal as unknown as AbortSignal | undefined,
            });

          progress.report({ message: 'Requesting device code…' });
          const auth = await startDeviceAuthorization({
            baseUrl: keyInfo.normalizedServerUrl,
            http,
            signal: controller.signal,
          });

          progress.report({ message: 'Open browser to enter code…' });
          const opened = await vscode.env.openExternal(vscode.Uri.parse(auth.verificationUriComplete));
          if (!opened) {
            void vscode.window.showInformationMessage(
              `OpenHands: Open this URL to login: ${auth.verificationUriComplete} (code: ${auth.userCode})`,
            );
          } else {
            const action = await vscode.window.showInformationMessage(
              `OpenHands: Enter code ${auth.userCode} to login to ${serverLabel}.`,
              'Copy code',
              'Copy URL',
            );
            if (action === 'Copy code') {
              await vscode.env.clipboard.writeText(auth.userCode);
            } else if (action === 'Copy URL') {
              await vscode.env.clipboard.writeText(auth.verificationUriComplete);
            }
          }

          progress.report({ message: 'Waiting for authorization…' });
          const deviceToken = await pollDeviceToken({
            baseUrl: keyInfo.normalizedServerUrl,
            http,
            deviceCode: auth.deviceCode,
            pollIntervalMs: auth.intervalMs,
            signal: controller.signal,
          });

          return deviceToken.accessToken;
        }
      );
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : String(err);
      if (name === 'DeviceFlowCancelledError' || name === 'AbortError') {
        void vscode.window.showInformationMessage('OpenHands: Login canceled.');
        return;
      }
      output?.appendLine(`[auth] Login failed: ${message}`);
      void vscode.window.showErrorMessage(`OpenHands: Login failed: ${message}`);
      return;
    }

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      void vscode.window.showErrorMessage('OpenHands: Login succeeded but returned an empty token.');
      return;
    }

    await context.secrets.store(keyInfo.secretKey, trimmedToken);

    let legacyRaw: string | undefined;
    try {
      legacyRaw = await context.secrets.get(LEGACY_SESSION_API_KEY_SECRET_KEY);
    } catch {
      legacyRaw = undefined;
    }
    const legacyValue = trimOrEmpty(legacyRaw);
    const canUpdateLegacy = !legacyValue || legacyValue === trimmedToken;
    if (canUpdateLegacy) {
      await context.secrets.store(LEGACY_SESSION_API_KEY_SECRET_KEY, trimmedToken);
    }

    output?.appendLine(`[auth] Stored session API key for ${keyInfo.normalizedServerUrl}.`);
    if (!canUpdateLegacy && legacyValue) {
      output?.appendLine('[auth] Legacy openhands.sessionApiKey was not overwritten (different value already set).');
    }

    options.onLoginCompleted?.({ normalizedServerUrl: keyInfo.normalizedServerUrl });

    const next = await vscode.window.showInformationMessage(
      `OpenHands: Logged in to ${serverLabel}.`,
      'Reconnect',
      'Start new conversation',
    );
    if (next === 'Reconnect') {
      await vscode.commands.executeCommand('openhands.reconnect');
    } else if (next === 'Start new conversation') {
      await vscode.commands.executeCommand('openhands.startNewConversation');
    }
  });
}
