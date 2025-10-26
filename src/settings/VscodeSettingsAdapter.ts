import * as vscode from 'vscode';
import type { SettingsAdapter } from './SettingsAdapter';

export class VscodeSettingsAdapter implements SettingsAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return vscode.workspace.getConfiguration().get<T>(key, defaultValue);
  }

  getExplicit<T = unknown>(key: string): T | undefined {
    const inspected = vscode.workspace.getConfiguration().inspect<T>(key);
    if (!inspected) return undefined;
    // Prefer workspace folder override, then workspace, then global
    return (inspected.workspaceFolderValue as T) ?? (inspected.workspaceValue as T) ?? (inspected.globalValue as T) ?? undefined;
  }

  async update<T = unknown>(key: string, value: T, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    await vscode.workspace.getConfiguration().update(key, value, target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  }

  async getSecret(key: string): Promise<string | undefined> {
    return await this.context.secrets.get(key) ?? undefined;
  }

  async storeSecret(key: string, value: string | undefined): Promise<void> {
    if (value === undefined || value === '') {
      await this.context.secrets.delete(key);
    } else {
      await this.context.secrets.store(key, value);
    }
  }
}
