import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeSettingsAdapter } from '../VscodeSettingsAdapter';
import * as vscode from 'vscode';

describe('VscodeSettingsAdapter', () => {
  let adapter: VscodeSettingsAdapter;
  let mockWorkspaceConfiguration: Pick<vscode.WorkspaceConfiguration, 'get' | 'inspect' | 'update'>;
  let mockGlobalConfiguration: Pick<vscode.WorkspaceConfiguration, 'get' | 'inspect' | 'update'>;
  let mockSecrets: Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>;
  let mockContext: Pick<vscode.ExtensionContext, 'secrets'>;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [{ uri: { fsPath: '/test/workspace' } }],
      configurable: true,
    });

    // Create mock objects
    mockWorkspaceConfiguration = {
      get: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
    };
    mockGlobalConfiguration = {
      get: vi.fn(),
      inspect: vi.fn(),
      update: vi.fn(),
    };

    mockSecrets = {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
    };

    mockContext = {
      secrets: mockSecrets as vscode.SecretStorage,
    };

    // Mock workspace.getConfiguration to return our mock configuration (scoped calls use the workspace config).
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation((_: any, scope?: any) => {
      return scope
        ? (mockWorkspaceConfiguration as vscode.WorkspaceConfiguration)
        : (mockGlobalConfiguration as vscode.WorkspaceConfiguration);
    });

    // Create adapter with mocked context
    adapter = new VscodeSettingsAdapter(mockContext as vscode.ExtensionContext);
  });

  describe('get()', () => {
    it('should retrieve value with default when provided', () => {
      const defaultValue = 'default-value';
      const expectedValue = 'test-value';
      mockWorkspaceConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get('test.key', defaultValue);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(mockWorkspaceConfiguration.get).toHaveBeenCalledWith('test.key', defaultValue);
      expect(result).toBe(expectedValue);
    });

    it('should retrieve value without default when not provided', () => {
      const expectedValue = 'test-value';
      mockWorkspaceConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get('test.key');

      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(mockWorkspaceConfiguration.get).toHaveBeenCalledWith('test.key');
      expect(result).toBe(expectedValue);
    });

    it('should handle nested keys correctly', () => {
      const nestedKey = 'parent.child.grandchild';
      const expectedValue = { nested: 'value' };
      mockWorkspaceConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get(nestedKey, {});

      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(mockWorkspaceConfiguration.get).toHaveBeenCalledWith(nestedKey, {});
      expect(result).toEqual(expectedValue);
    });
  });

  describe('getExplicit()', () => {
    it('should return undefined when no explicit value is set', () => {
      mockWorkspaceConfiguration.inspect.mockReturnValue(undefined);

      const result = adapter.getExplicit('test.key');

      expect(mockWorkspaceConfiguration.inspect).toHaveBeenCalledWith('test.key');
      expect(result).toBeUndefined();
    });

    it('should prefer workspace folder value over workspace and global', () => {
      const workspaceFolderValue = 'workspace-folder-value';
      const workspaceValue = 'workspace-value';
      const globalValue = 'global-value';

      mockWorkspaceConfiguration.inspect.mockReturnValue({
        workspaceFolderValue,
        workspaceValue,
        globalValue,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBe(workspaceFolderValue);
    });

    it('should prefer workspace value over global when workspace folder is undefined', () => {
      const workspaceValue = 'workspace-value';
      const globalValue = 'global-value';

      mockWorkspaceConfiguration.inspect.mockReturnValue({
        workspaceValue,
        globalValue,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBe(workspaceValue);
    });

    it('should return global value when only global is set', () => {
      const globalValue = 'global-value';

      mockWorkspaceConfiguration.inspect.mockReturnValue({
        globalValue,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBe(globalValue);
    });

    it('should return undefined when inspect returns object with all undefined values', () => {
      mockWorkspaceConfiguration.inspect.mockReturnValue({
        workspaceFolderValue: undefined,
        workspaceValue: undefined,
        globalValue: undefined,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBeUndefined();
    });

    it('should return workspace value for openhands.llm.profileId (even though it is persisted globally)', () => {
      mockWorkspaceConfiguration.inspect.mockReturnValue({
        workspaceFolderValue: 'workspace-folder-profile',
        workspaceValue: 'workspace-profile',
        globalValue: 'global-profile',
      });

      const result = adapter.getExplicit('openhands.llm.profileId');

      expect(result).toBe('workspace-folder-profile');
    });
  });

  describe('update()', () => {
    it('should update configuration for workspace target', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockWorkspaceConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value, 'workspace');

      expect(mockWorkspaceConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
    });

    it('should fall back to global when no workspace is open', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockWorkspaceConfiguration.update.mockResolvedValue(undefined);

      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: [],
        configurable: true,
      });

      await adapter.update(key, value, 'workspace');

      expect(mockGlobalConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.Global
      );
    });

    it('should update configuration for global target', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockGlobalConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value, 'global');

      expect(mockGlobalConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.Global
      );
    });

    it('should default to workspace target when target not specified', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockWorkspaceConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value);

      expect(mockWorkspaceConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
    });

    it('should clear workspace overrides and persist openhands.llm.profileId globally', async () => {
      mockWorkspaceConfiguration.inspect.mockReturnValue({
        workspaceFolderValue: 'workspace-folder-profile',
        workspaceValue: 'workspace-profile',
        globalValue: 'global-profile',
      });
      mockWorkspaceConfiguration.update.mockResolvedValue(undefined);
      mockGlobalConfiguration.update.mockResolvedValue(undefined);

      await adapter.update('openhands.llm.profileId', 'new-profile', 'global');

      expect(mockWorkspaceConfiguration.update).toHaveBeenCalledWith(
        'openhands.llm.profileId',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder
      );
      expect(mockGlobalConfiguration.update).toHaveBeenCalledWith(
        'openhands.llm.profileId',
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
      expect(mockGlobalConfiguration.update).toHaveBeenCalledWith(
        'openhands.llm.profileId',
        'new-profile',
        vscode.ConfigurationTarget.Global
      );
    });
  });

  describe('getSecret()', () => {
    it('should retrieve existing secret', async () => {
      const key = 'test-secret';
      const secretValue = 'secret-value';
      mockSecrets.get.mockResolvedValue(secretValue);

      const result = await adapter.getSecret(key);

      expect(mockSecrets.get).toHaveBeenCalledWith(key);
      expect(result).toBe(secretValue);
    });

    it('should return undefined when secret does not exist', async () => {
      const key = 'non-existent-secret';
      mockSecrets.get.mockResolvedValue(undefined);

      const result = await adapter.getSecret(key);

      expect(mockSecrets.get).toHaveBeenCalledWith(key);
      expect(result).toBeUndefined();
    });
  });

  describe('storeSecret()', () => {
    it('should store secret when value is provided', async () => {
      const key = 'test-secret';
      const value = 'secret-value';
      mockSecrets.store.mockResolvedValue(undefined);

      await adapter.storeSecret(key, value);

      expect(mockSecrets.store).toHaveBeenCalledWith(key, value);
      expect(mockSecrets.delete).not.toHaveBeenCalled();
    });

    it('should delete secret when value is undefined', async () => {
      const key = 'test-secret';
      mockSecrets.delete.mockResolvedValue(undefined);

      await adapter.storeSecret(key, undefined);

      expect(mockSecrets.delete).toHaveBeenCalledWith(key);
      expect(mockSecrets.store).not.toHaveBeenCalled();
    });

    it('should delete secret when value is empty string', async () => {
      const key = 'test-secret';
      mockSecrets.delete.mockResolvedValue(undefined);

      await adapter.storeSecret(key, '');

      expect(mockSecrets.delete).toHaveBeenCalledWith(key);
      expect(mockSecrets.store).not.toHaveBeenCalled();
    });
  });
});
