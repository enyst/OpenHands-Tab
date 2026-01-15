import * as vscode from 'vscode';
import type { SettingsAdapter } from './SettingsAdapter';

export class VscodeSettingsAdapter implements SettingsAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  private isProfileIdKey(key: string): boolean {
    return key === 'openhands.llm.profileId';
  }

  private isGlobalOnlyKey(key: string): boolean {
    return key === 'openhands.serverUrl'
      || key === 'openhands.servers'
      || key === 'openhands.llm.profileId'
      || key === 'openhands.oracle.profileId';
  }

  private getWorkspaceFolderUriForConfiguration(): vscode.Uri | undefined {
    const activeUri = vscode.window.activeTextEditor?.document?.uri;
    if (activeUri) {
      const folder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (folder) return folder.uri;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) return folders[0].uri;

    return undefined;
  }

  private getWorkspaceConfiguration(): vscode.WorkspaceConfiguration {
    const workspaceFolderUri = this.getWorkspaceFolderUriForConfiguration();
    return workspaceFolderUri
      ? vscode.workspace.getConfiguration(undefined, workspaceFolderUri)
      : vscode.workspace.getConfiguration();
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (this.isProfileIdKey(key)) {
      const inspected = this.getWorkspaceConfiguration().inspect<T>(key);
      const value = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
      return value !== undefined ? value : defaultValue;
    }
    if (this.isGlobalOnlyKey(key)) {
      const inspected = vscode.workspace.getConfiguration().inspect<T>(key);
      const globalValue = inspected?.globalValue;
      return globalValue !== undefined ? globalValue : defaultValue;
    }
    const cfg = this.getWorkspaceConfiguration();
    return defaultValue !== undefined
      ? cfg.get<T>(key, defaultValue)
      : cfg.get<T>(key);
  }

  getExplicit<T = unknown>(key: string): T | undefined {
    if (this.isProfileIdKey(key)) {
      const inspected = this.getWorkspaceConfiguration().inspect<T>(key);
      if (!inspected) return undefined;
      return inspected.workspaceFolderValue ?? inspected.workspaceValue ?? inspected.globalValue ?? undefined;
    }
    if (this.isGlobalOnlyKey(key)) {
      const inspected = vscode.workspace.getConfiguration().inspect<T>(key);
      return inspected?.globalValue ?? undefined;
    }
    const inspected = this.getWorkspaceConfiguration().inspect<T>(key);
    if (!inspected) return undefined;
    // Prefer workspace folder override, then workspace, then global
    return inspected.workspaceFolderValue ?? inspected.workspaceValue ?? inspected.globalValue ?? undefined;
  }

  async update<T = unknown>(key: string, value: T, target: 'workspace' | 'global' = 'workspace'): Promise<void> {
    if (this.isProfileIdKey(key)) {
      const globalConfig = vscode.workspace.getConfiguration();
      const workspaceConfig = this.getWorkspaceConfiguration();
      const inspected = workspaceConfig.inspect<T>(key);

      // If the user configured a workspace/workspace-folder override for profile selection, clear it
      // so the explicit selection we persist here takes effect immediately and avoids "snap back".
      if (inspected?.workspaceFolderValue !== undefined) {
        await workspaceConfig.update(key, undefined as unknown as T, vscode.ConfigurationTarget.WorkspaceFolder);
      }
      if (inspected?.workspaceValue !== undefined) {
        await globalConfig.update(key, undefined as unknown as T, vscode.ConfigurationTarget.Workspace);
      }

      await globalConfig.update(key, value, vscode.ConfigurationTarget.Global);
      return;
    }
    if (this.isGlobalOnlyKey(key)) {
      await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
      return;
    }

    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const isMultiRootWorkspace = !!vscode.workspace.workspaceFile;
    const effectiveTarget = (() => {
      if (target !== 'workspace') return vscode.ConfigurationTarget.Global;
      if (!hasWorkspace) return vscode.ConfigurationTarget.Global;
      return isMultiRootWorkspace
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.WorkspaceFolder;
    })();

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
