export type SecretValueSource = {
  getRegisteredValues: () => string[];
};

const MIN_SECRET_CHARS = 4;

export function maskSecretsInText(text: string, secrets?: SecretValueSource): string {
  if (!text || typeof text !== 'string') return String(text);
  if (!secrets) return text;

  const values = Array.from(
    new Set(
      secrets
        .getRegisteredValues()
        .map((rawValue) => (typeof rawValue === 'string' ? rawValue.trim() : ''))
        .filter((value) => value.length >= MIN_SECRET_CHARS),
    ),
  ).sort((a, b) => b.length - a.length);

  let masked = text;
  for (const value of values) {
    if (!masked.includes(value)) continue;
    masked = masked.split(value).join('[REDACTED]');
  }
  return masked;
}
