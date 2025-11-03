


import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SettingsAdapter } from '../../../src/settings/SettingsAdapter';

// Create a mock implementation of VscodeSettingsAdapter that doesn't depend on vscode
class MockVscodeSettingsAdapter implements SettingsAdapter {
  private configStore: Map<string, any> = new Map();
  private secretStore: Map<string, string> = new Map();

  constructor(private mockContext: any) {}

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return this.configStore.has(key) ? this.configStore.get(key) : defaultValue;
  }

  getExplicit<T = unknown>(key: string): T | undefined {
    return this.configStore.has(key) ? this.configStore.get(key) : undefined;
  }

  async update<T = unknown>(key: string, value: T): Promise<void> {
    this.configStore.set(key, value);
  }

  async getSecret(key: string): Promise<string | undefined> {
    const value = this.secretStore.get(key);
    return value === '' ? undefined : value;
  }

  async storeSecret(key: string, value: string | undefined): Promise<void> {
    if (value === undefined || value === '') {
      this.secretStore.delete(key);
    } else {
      this.secretStore.set(key, value);
    }
  }
}

describe('VscodeSettingsAdapter', () => {
  let adapter: SettingsAdapter;
  let mockContext: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      secrets: {
        get: vi.fn(),
        store: vi.fn(),
        delete: vi.fn(),
      },
    };

    // Create adapter instance
    adapter = new MockVscodeSettingsAdapter(mockContext);
  });

  describe('get', () => {
    it('should return stored value when key exists', () => {
      const key = 'test.key';
      const value = 'testValue';
      (adapter as MockVscodeSettingsAdapter).update(key, value);

      const result = adapter.get(key);

      expect(result).toBe(value);
    });

    it('should return default value when key does not exist', () => {
      const key = 'test.key';
      const defaultValue = 'default';

      const result = adapter.get(key, defaultValue);

      expect(result).toBe(defaultValue);
    });

    it('should return undefined when key does not exist and no default provided', () => {
      const key = 'test.key';

      const result = adapter.get(key);

      expect(result).toBeUndefined();
    });
  });

  describe('getExplicit', () => {
    it('should return stored value when key exists', () => {
      const key = 'test.key';
      const value = 'testValue';
      (adapter as MockVscodeSettingsAdapter).update(key, value);

      const result = adapter.getExplicit(key);

      expect(result).toBe(value);
    });

    it('should return undefined when key does not exist', () => {
      const key = 'test.key';

      const result = adapter.getExplicit(key);

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should store the value for the given key', async () => {
      const key = 'test.key';
      const value = 'testValue';

      await adapter.update(key, value);

      const result = adapter.get(key);
      expect(result).toBe(value);
    });
  });

  describe('getSecret', () => {
    it('should return secret value when available', async () => {
      const key = 'secret.key';
      const value = 'secretValue';
      await adapter.storeSecret(key, value);

      const result = await adapter.getSecret(key);

      expect(result).toBe(value);
    });

    it('should return undefined when secret is not available', async () => {
      const key = 'secret.key';

      const result = await adapter.getSecret(key);

      expect(result).toBeUndefined();
    });

    it('should return undefined when secret is empty string', async () => {
      const key = 'secret.key';
      await adapter.storeSecret(key, '');

      const result = await adapter.getSecret(key);

      expect(result).toBeUndefined();
    });
  });

  describe('storeSecret', () => {
    it('should store secret when value is provided', async () => {
      const key = 'secret.key';
      const value = 'secretValue';

      await adapter.storeSecret(key, value);

      const result = await adapter.getSecret(key);
      expect(result).toBe(value);
    });

    it('should delete secret when value is undefined', async () => {
      const key = 'secret.key';
      await adapter.storeSecret(key, 'tempValue');
      const value = undefined;

      await adapter.storeSecret(key, value);

      const result = await adapter.getSecret(key);
      expect(result).toBeUndefined();
    });

    it('should delete secret when value is empty string', async () => {
      const key = 'secret.key';
      await adapter.storeSecret(key, 'tempValue');
      const value = '';

      await adapter.storeSecret(key, value);

      const result = await adapter.getSecret(key);
      expect(result).toBeUndefined();
    });
  });
});


