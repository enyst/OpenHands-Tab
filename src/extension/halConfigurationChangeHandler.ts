import * as vscode from 'vscode';
import { SettingsManager } from '../settings/SettingsManager';
import { VscodeSettingsAdapter } from '../settings/VscodeSettingsAdapter';
import type { HostToWebviewMessage } from '../shared/webviewMessages';

export type HalConfigurationChangeHandlerDeps = {
  context: vscode.ExtensionContext;
  getChatView: () => vscode.WebviewView | undefined;
  isChatWebviewReady: () => boolean;
  getOutputChannel: () => vscode.OutputChannel | undefined;
  renderError: (err: unknown) => string;
};

export function createHalConfigurationChangeHandler(deps: HalConfigurationChangeHandlerDeps) {
  return async (e: vscode.ConfigurationChangeEvent) => {
    if (!e.affectsConfiguration('openhands.hal')) return;

    try {
      const settingsMgr = new SettingsManager(new VscodeSettingsAdapter(deps.context));
      const settings = await settingsMgr.get();
      const chatView = deps.getChatView();
      if (chatView && deps.isChatWebviewReady()) {
        void chatView.webview.postMessage({ type: 'halSettings', hal: settings.hal } satisfies HostToWebviewMessage);
      }
    } catch (err: unknown) {
      deps.getOutputChannel()?.appendLine(`[settings] Failed to apply HAL settings update: ${deps.renderError(err)}`);
    }
  };
}

