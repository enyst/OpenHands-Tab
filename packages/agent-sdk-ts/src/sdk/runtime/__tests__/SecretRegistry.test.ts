import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStorage } from 'vscode';
import { SecretRegistry } from '../SecretRegistry';

const secretName = 'test_secret_registry_key';
const envKey = secretName.toUpperCase();

function makeStorage(value: string | undefined) {
  const getSpy = vi.fn(async () => value);
  const storage = { get: getSpy } as unknown as SecretStorage;
  return { storage, getSpy };
}

describe('SecretRegistry', () => {
  let previousEnvValue: string | undefined;

  beforeEach(() => {
    previousEnvValue = process.env[envKey];
    delete process.env[envKey];
  });

  afterEach(() => {
    if (previousEnvValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previousEnvValue;
    }
    vi.restoreAllMocks();
  });

  it('prefers SecretStorage over env when both are present', async () => {
    process.env[envKey] = 'from-env';
    const { storage, getSpy } = makeStorage('from-storage');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-storage');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(secretName);
  });

  it('falls back to env when SecretStorage is empty', async () => {
    process.env[envKey] = 'from-env';
    const { storage, getSpy } = makeStorage(undefined);
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-env');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('treats empty/whitespace SecretStorage values as unset (falls back to env)', async () => {
    process.env[envKey] = 'from-env';
    const { storage, getSpy } = makeStorage('   ');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-env');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('trims SecretStorage values when present', async () => {
    const { storage } = makeStorage('  from-storage  ');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-storage');
  });

  it('trims env values when SecretStorage is empty', async () => {
    process.env[envKey] = '  from-env  ';
    const { storage } = makeStorage('');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-env');
  });

  it('returns SecretStorage when env is absent', async () => {
    const { storage, getSpy } = makeStorage('from-storage');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-storage');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('caches values after first read (SecretStorage precedence)', async () => {
    process.env[envKey] = 'from-env';
    const { storage, getSpy } = makeStorage('from-storage');
    const registry = new SecretRegistry(storage, null);

    await expect(registry.get(secretName)).resolves.toBe('from-storage');

    process.env[envKey] = 'changed-env';
    getSpy.mockResolvedValue('changed-storage');

    await expect(registry.get(secretName)).resolves.toBe('from-storage');
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('caches env values after first read when no SecretStorage is provided', async () => {
    process.env[envKey] = 'from-env';
    const registry = new SecretRegistry(undefined, null);

    await expect(registry.get(secretName)).resolves.toBe('from-env');

    process.env[envKey] = 'changed-env';

    await expect(registry.get(secretName)).resolves.toBe('from-env');
  });

});
