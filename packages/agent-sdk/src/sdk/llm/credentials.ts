import { SecretRegistry } from '../runtime/SecretRegistry';

const FALLBACK_KEY_ORDER = [
  'openhands.llmApiKey',
  'LLM_API_KEY',
];

export class LLMCredentialProvider {
  private readonly registry: SecretRegistry;

  constructor(registry?: SecretRegistry) {
    this.registry = registry ?? new SecretRegistry();
  }

  async getApiKey(preferredKeys?: string | string[]): Promise<string | undefined> {
    const orderedKeys = Array.isArray(preferredKeys)
      ? [...preferredKeys, ...FALLBACK_KEY_ORDER]
      : preferredKeys
        ? [preferredKeys, ...FALLBACK_KEY_ORDER]
        : [...FALLBACK_KEY_ORDER];

    for (const key of orderedKeys) {
      const value = await this.registry.get(key);
      if (value) return value;
    }
    return undefined;
  }
}
