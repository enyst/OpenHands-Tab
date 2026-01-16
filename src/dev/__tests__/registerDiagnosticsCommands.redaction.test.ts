import { describe, it, expect } from 'vitest';
import { sanitizeDiagnosticsText } from '../registerDiagnosticsCommands';

describe('sanitizeDiagnosticsText', () => {
  it('masks before truncating to avoid partial-secret leaks', () => {
    const secret = 'super-secret-token';
    const text = `prefix ${secret} suffix`;

    const preview = sanitizeDiagnosticsText(text, {
      // Only `getRegisteredValues()` is needed by maskSecretsInText()
      secretRegistry: { getRegisteredValues: () => [secret] } as any,
      maxChars: 'prefix '.length + 6, // would include only a partial secret if we truncated first
    });

    expect(preview).not.toContain('super');
    expect(preview).not.toContain(secret);
    expect(preview).toContain('prefix ');
  });
});

