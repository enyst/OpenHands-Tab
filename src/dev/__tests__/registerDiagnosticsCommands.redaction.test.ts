import { describe, it, expect } from 'vitest';
import { SecretRegistry } from '@smolpaws/agent-sdk';
import { sanitizeDiagnosticsText } from '../registerDiagnosticsCommands';

describe('sanitizeDiagnosticsText', () => {
  it('masks before truncating to avoid partial-secret leaks', () => {
    const secret = 'super-secret-token';
    const text = `prefix ${secret} suffix`;

    const secretRegistry = new SecretRegistry();
    secretRegistry.register('test', secret);

    const preview = sanitizeDiagnosticsText(text, {
      secretRegistry,
      maxChars: 'prefix '.length + 6, // would include only a partial secret if we truncated first
    });

    expect(preview).not.toContain('super');
    expect(preview).not.toContain(secret);
    expect(preview).toContain('prefix ');
  });

  it('does not add a truncated suffix when the masked text is short enough', () => {
    const secret = 'super-secret-token';
    const text = `prefix ${secret} suffix`;

    const secretRegistry = new SecretRegistry();
    secretRegistry.register('test', secret);

    const preview = sanitizeDiagnosticsText(text, { secretRegistry, maxChars: 4000 });

    expect(preview).not.toContain(secret);
    expect(preview).not.toContain('…(truncated)');
  });

  it('redacts common token patterns even without registered secrets', () => {
    const text = 'Authorization: Bearer sk-abcdef1234567890';

    const preview = sanitizeDiagnosticsText(text, { maxChars: 4000 });

    expect(preview).toContain('[REDACTED]');
    expect(preview).not.toContain('sk-abcdef1234567890');
  });
});
