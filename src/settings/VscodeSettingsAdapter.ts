import * as vscode from 'vscode';
import type { SettingsAdapter } from './SettingsAdapter';

export class VscodeSettingsAdapter implements SettingsAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  private getWorkspaceConfiguration(): vscode.WorkspaceConfiguration {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder
      ? vscode.workspace.getConfiguration(undefined, workspaceFolder.uri)
      : vscode.workspace.getConfiguration();
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const cfg = this.getWorkspaceConfiguration();
    return defaultValue !== undefined
      ? cfg.get<T>(key, defaultValue)
      : cfg.get<T>(key);
  }

  getExplicit<T = unknown>(key: string): T | undefined {
    const inspected = this.getWorkspaceConfiguration().inspect<T>(key);
    if (!inspected) return undefined;
    // Prefer workspace folder override, then workspace, then global
    return (inspected.workspaceFolderValue as T) ?? (inspected.workspaceValue as T) ?? (inspected.globalValue as T) ?? undefined;
  }

  async update<T = unknown>(key: string, value: T, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    const hasWorkspaceFolder = !!vscode.workspace.workspaceFolders?.length;
    const effectiveTarget =
      target === 'workspace' && hasWorkspaceFolder
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Global;

    const cfg =
      effectiveTarget === vscode.ConfigurationTarget.WorkspaceFolder
        ? this.getWorkspaceConfiguration()
        : vscode.workspace.getConfiguration();

    await cfg.update(key, value, effectiveTarget);
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
