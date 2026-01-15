import { describe, expect, it } from 'vitest';
import { createTokenStorage, type SecretStorageLike } from '../tokenStorage';

function createInMemorySecretStorage(initial?: Record<string, string>): SecretStorageLike {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : undefined;
    },
    async store(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe('token storage (SecretStorage semantics)', () => {
  it('missing key: get returns undefined; has=false', async () => {
    const storage = createTokenStorage(createInMemorySecretStorage());
    await expect(storage.get('missing')).resolves.toBeUndefined();
    await expect(storage.has('missing')).resolves.toBe(false);
  });

  it('get trims surrounding whitespace', async () => {
    const storage = createTokenStorage(createInMemorySecretStorage());
    await storage.store('k', '  sk-test \n');
    await expect(storage.get('k')).resolves.toBe('sk-test');
  });

  it('empty/whitespace values are treated as set (has=true) and get returns empty string after trim', async () => {
    const storage = createTokenStorage(createInMemorySecretStorage());
    await storage.store('empty', '');
    await storage.store('ws', '   \n\t');

    await expect(storage.has('empty')).resolves.toBe(true);
    await expect(storage.get('empty')).resolves.toBe('');

    await expect(storage.has('ws')).resolves.toBe(true);
    await expect(storage.get('ws')).resolves.toBe('');
  });

  it('store overwrites existing value', async () => {
    const storage = createTokenStorage(createInMemorySecretStorage());
    await storage.store('k', 'a');
    await storage.store('k', 'b');
    await expect(storage.get('k')).resolves.toBe('b');
  });

  it('delete removes key and returns whether it existed', async () => {
    const storage = createTokenStorage(createInMemorySecretStorage({ k: 'v' }));
    await expect(storage.delete('k')).resolves.toBe(true);
    await expect(storage.has('k')).resolves.toBe(false);
    await expect(storage.delete('k')).resolves.toBe(false);
  });
});

