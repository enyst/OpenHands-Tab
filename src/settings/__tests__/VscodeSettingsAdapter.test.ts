import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeSettingsAdapter } from '../VscodeSettingsAdapter';
import * as vscode from 'vscode';

describe('VscodeSettingsAdapter', () => {
  let adapter: VscodeSettingsAdapter;
  let mockConfiguration: any;
  let mockSecrets: any;
  let mockContext: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create mock objects
    mockConfiguration = {
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
      secrets: mockSecrets,
    };

    // Mock workspace.getConfiguration to return our mock configuration
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfiguration as any);

    // Create adapter with mocked context
    adapter = new VscodeSettingsAdapter(mockContext as vscode.ExtensionContext);
  });

  describe('get()', () => {
    it('should retrieve value with default when provided', () => {
      const defaultValue = 'default-value';
      const expectedValue = 'test-value';
      mockConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get('test.key', defaultValue);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(mockConfiguration.get).toHaveBeenCalledWith('test.key', defaultValue);
      expect(result).toBe(expectedValue);
    });

    it('should retrieve value without default when not provided', () => {
      const expectedValue = 'test-value';
      mockConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get('test.key');

      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(mockConfiguration.get).toHaveBeenCalledWith('test.key');
      expect(result).toBe(expectedValue);
    });

    it('should handle nested keys correctly', () => {
      const nestedKey = 'parent.child.grandchild';
      const expectedValue = { nested: 'value' };
      mockConfiguration.get.mockReturnValue(expectedValue);

      const result = adapter.get(nestedKey, {});

      expect(mockConfiguration.get).toHaveBeenCalledWith(nestedKey, {});
      expect(result).toEqual(expectedValue);
    });
  });

  describe('getExplicit()', () => {
    it('should return undefined when no explicit value is set', () => {
      mockConfiguration.inspect.mockReturnValue(undefined);

      const result = adapter.getExplicit('test.key');

      expect(mockConfiguration.inspect).toHaveBeenCalledWith('test.key');
      expect(result).toBeUndefined();
    });

    it('should prefer workspace folder value over workspace and global', () => {
      const workspaceFolderValue = 'workspace-folder-value';
      const workspaceValue = 'workspace-value';
      const globalValue = 'global-value';

      mockConfiguration.inspect.mockReturnValue({
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

      mockConfiguration.inspect.mockReturnValue({
        workspaceValue,
        globalValue,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBe(workspaceValue);
    });

    it('should return global value when only global is set', () => {
      const globalValue = 'global-value';

      mockConfiguration.inspect.mockReturnValue({
        globalValue,
      });

      const result = adapter.getExplicit('test.key');

      expect(result).toBe(globalValue);
    });
  });

  describe('update()', () => {
    it('should update configuration for workspace target', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value, 'workspace');

      expect(mockConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.Workspace
      );
    });

    it('should update configuration for global target', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value, 'global');

      expect(mockConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.Global
      );
    });

    it('should default to workspace target when target not specified', async () => {
      const key = 'test.key';
      const value = 'test-value';
      mockConfiguration.update.mockResolvedValue(undefined);

      await adapter.update(key, value);

      expect(mockConfiguration.update).toHaveBeenCalledWith(
        key,
        value,
        vscode.ConfigurationTarget.Workspace
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
      mockSecrets.get.mockResolvedValue(null);

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
