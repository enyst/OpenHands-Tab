import * as vscode from 'vscode';
import { SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import { computeWelcomeSecretStatus } from '../shared/welcomeSecretStatus';
import type { HostToWebviewMessage } from '../shared/webviewMessages';

type WelcomeSecretStatusSyncDeps = {
  context: vscode.ExtensionContext;
  getChatView: () => vscode.WebviewView | undefined;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
};

export function registerWelcomeSecretStatusSync({
  context,
  getChatView,
  getOutputChannel,
  renderError,
}: WelcomeSecretStatusSyncDeps): vscode.Disposable {
  const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(context));
  let lastWelcomeSecretStatus: { hasProviderKey: boolean; hasGeminiKey: boolean } | null = null;
  let welcomeSecretStatusTimer: ReturnType<typeof setTimeout> | null = null;
  const subscriptions: vscode.Disposable[] = [];

  const postWelcomeSecretStatus = async (): Promise<void> => {
    const chatView = getChatView();
    if (!chatView) return;

    const settings = await settingsMgr.get();
    const status = await computeWelcomeSecretStatus({ context, settings });
    if (
      lastWelcomeSecretStatus &&
      lastWelcomeSecretStatus.hasProviderKey === status.hasProviderKey &&
      lastWelcomeSecretStatus.hasGeminiKey === status.hasGeminiKey
    ) {
      return;
    }

    lastWelcomeSecretStatus = status;
    void chatView.webview.postMessage({ type: 'welcomeSecretStatus', ...status } satisfies HostToWebviewMessage);
  };

  const scheduleWelcomeSecretStatusUpdate = () => {
    if (welcomeSecretStatusTimer) clearTimeout(welcomeSecretStatusTimer);
    welcomeSecretStatusTimer = setTimeout(() => {
      welcomeSecretStatusTimer = null;
      void postWelcomeSecretStatus().catch((err: unknown) => {
        getOutputChannel()?.appendLine(`[welcome] Failed to compute secret status: ${renderError(err)}`);
      });
    }, 150);
  };

  // Watch SecretStorage so welcome-page onboarding prompts reflect current key state.
  const secretsOnDidChange = (context.secrets as unknown as { onDidChange?: vscode.Event<{ key: string }> })
    .onDidChange;
  if (typeof secretsOnDidChange === 'function') {
    subscriptions.push(
      secretsOnDidChange(() => {
        scheduleWelcomeSecretStatusUpdate();
      })
    );
  }

  return {
    dispose: () => {
      if (welcomeSecretStatusTimer) {
        clearTimeout(welcomeSecretStatusTimer);
        welcomeSecretStatusTimer = null;
      }
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
    },
  };
}
