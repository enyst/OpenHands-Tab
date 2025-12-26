import { redactStringHeuristics } from './textSanitizers';
import { CIRCULAR_REFERENCE_MARKER } from './toolResultTruncation';

export class SecretMasker {
  private cache: { signature: string; values: string[] } | null = null;

  constructor(
    private readonly deps: {
      getConfiguredSecrets: () => unknown[];
      getRegisteredSecrets: () => string[];
    }
  ) { }

  private getSecretValuesForMasking(): string[] {
    const configuredSecrets = this.deps
      .getConfiguredSecrets()
      .filter((secret): secret is string => typeof secret === 'string')
      .map((secret) => secret.trim())
      .filter(Boolean);
    const registeredSecrets = this.deps.getRegisteredSecrets();
    const signature = `${configuredSecrets.join('\u0000')}\u0001${registeredSecrets.join('\u0000')}`;
    if (this.cache?.signature === signature) {
      return this.cache.values;
    }

    const values = new Set<string>();
    const maybePush = (candidate: unknown) => {
      if (typeof candidate !== 'string') return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      if (/^[A-Z0-9_]+$/.test(trimmed)) {
        values.add(trimmed);
        const envValue = process.env[trimmed];
        if (envValue) {
          values.add(envValue);
        }
      } else {
        values.add(trimmed);
      }
    };

    for (const secret of configuredSecrets) {
      maybePush(secret);
    }

    for (const secret of registeredSecrets) {
      maybePush(secret);
    }

    const envKeyLooksSensitive = /(?:^|_)(?:API_?KEY|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD)(?:$|_)/i;
    for (const [key, value] of Object.entries(process.env)) {
      if (!value) continue;
      if (!envKeyLooksSensitive.test(key)) continue;
      values.add(value);
    }

    const computed = Array.from(values)
      .filter((value) => value.length >= 8)
      .sort((a, b) => b.length - a.length);
    this.cache = { signature, values: computed };
    return computed;
  }

  maskText(text: string): string {
    let masked = text;
    for (const secret of this.getSecretValuesForMasking()) {
      masked = masked.replaceAll(secret, '***');
    }
    return redactStringHeuristics(masked);
  }

  maskUnknown(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') {
      return this.maskText(value);
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
      seen.add(value);
      return value.map((item) => this.maskUnknown(item, seen));
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) return value;
      if (seen.has(value)) return CIRCULAR_REFERENCE_MARKER;
      seen.add(value);
      const masked: Record<string, unknown> = {};
      for (const [key, inner] of entries) {
        masked[key] = this.maskUnknown(inner, seen);
      }
      return masked;
    }
    return value;
  }
}

