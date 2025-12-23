import type { SecretStorage } from 'vscode';

const loadVscode = (): typeof import('vscode') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('vscode') as typeof import('vscode');
  } catch {
    return null;
  }
};

export class SecretRegistry {
  private readonly secrets: Map<string, string> = new Map();
  private readonly vscodeApi: typeof import('vscode') | null;
  private readonly storage?: SecretStorage;

  constructor(storage?: SecretStorage, vscodeModule: typeof import('vscode') | null = loadVscode()) {
    this.storage = storage;
    this.vscodeApi = vscodeModule;
  }

  register(name: string, value: string): void {
    this.secrets.set(name, value);
  }

  set(name: string, value: string | undefined): void {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      this.secrets.delete(name);
      return;
    }
    this.secrets.set(name, trimmed);
  }

  async get(name: string): Promise<string | undefined> {
    if (this.secrets.has(name)) {
      return this.secrets.get(name);
    }

    const envKey = name.toUpperCase();
    const envValue = process.env[envKey];
    if (envValue) {
      this.secrets.set(name, envValue);
      return envValue;
    }

    if (this.storage) {
      const stored = await this.storage.get(name);
      if (stored) {
        this.secrets.set(name, stored);
      }
      return stored;
    }

    return undefined;
  }

  getRegisteredValues(): string[] {
    return Array.from(this.secrets.values());
  }

  getRegisteredNames(): string[] {
    return Array.from(this.secrets.keys());
  }
}
