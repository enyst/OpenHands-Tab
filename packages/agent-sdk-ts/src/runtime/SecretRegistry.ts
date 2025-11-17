import type { SecretStorage } from 'vscode';

const loadVscode = (): typeof import('vscode') | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    return require('vscode') as typeof import('vscode');
  } catch (err) {
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

  async get(name: string): Promise<string | undefined> {
    if (this.secrets.has(name)) {
      return this.secrets.get(name);
    }

    const envKey = name.toUpperCase();
    if (process.env[envKey]) {
      return process.env[envKey];
    }

    if (this.storage) {
      return this.storage.get(name);
    }

    return undefined;
  }
}
