export type SecretValueSource = {
  getRegisteredValues: () => string[];
};

const MIN_SECRET_CHARS = 4;

export function maskSecretsInText(text: string, secrets?: SecretValueSource): string {
  if (!text || typeof text !== 'string') return String(text);
  if (!secrets) return text;

  let masked = text;
  for (const rawValue of secrets.getRegisteredValues()) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value || value.length < MIN_SECRET_CHARS) continue;
    if (!masked.includes(value)) continue;
    masked = masked.split(value).join('[REDACTED]');
  }
  return masked;
}

