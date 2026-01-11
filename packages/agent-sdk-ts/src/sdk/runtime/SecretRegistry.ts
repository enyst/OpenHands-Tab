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
  private readonly exportedValues: Map<string, string> = new Map();
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
      const value = this.secrets.get(name);
      if (value) {
        this.exportedValues.set(name, value);
      }
      return value;
    }

    // Prefer SecretStorage over environment variables to allow user-set keys to override env.
    if (this.storage) {
      const stored = await this.storage.get(name);
      if (stored) {
        this.secrets.set(name, stored);
        this.exportedValues.set(name, stored);
        return stored;
      }
    }

    const envKey = name.toUpperCase();
    const envValue = process.env[envKey];
    if (envValue) {
      this.secrets.set(name, envValue);
      this.exportedValues.set(name, envValue);
      return envValue;
    }

    return undefined;
  }

  recordExported(name: string, value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    this.exportedValues.set(name, trimmed);
  }

  maskSecretsInText(text: string | undefined | null): string {
    if (!text) return text ?? '';
    let masked = text;
    const sortedValues = Array.from(this.exportedValues.values()).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const value of sortedValues) {
      masked = masked.split(value).join('<secret-hidden>');
    }
    return masked;
  }

  getRegisteredValues(): string[] {
    return Array.from(this.secrets.values());
  }

  getRegisteredNames(): string[] {
    return Array.from(this.secrets.keys());
  }
}
