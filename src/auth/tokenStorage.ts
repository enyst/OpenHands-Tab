export type SecretStorageLike = {
  get: (key: string) => Promise<string | undefined>;
  store: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

export type TokenStorage = {
  get: (key: string) => Promise<string | undefined>;
  has: (key: string) => Promise<boolean>;
  store: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
};

export function createTokenStorage(secrets: SecretStorageLike): TokenStorage {
  return {
    async get(key: string): Promise<string | undefined> {
      const raw = await secrets.get(key);
      if (raw === undefined) return undefined;
      return raw.trim();
    },

    async has(key: string): Promise<boolean> {
      const raw = await secrets.get(key);
      return raw !== undefined;
    },

    async store(key: string, value: string): Promise<void> {
      await secrets.store(key, value.trim());
    },

    async delete(key: string): Promise<boolean> {
      const raw = await secrets.get(key);
      const existed = raw !== undefined;
      await secrets.delete(key);
      return existed;
    },
  };
}

