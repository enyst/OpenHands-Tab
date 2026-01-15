import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI token storage tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_token_storage.py`
 *
 * Note: oh-tab uses VS Code SecretStorage rather than a plaintext file.
 */
describe('Token storage (SecretStorage) - ported scenarios', () => {
  it.todo('per-server storage: write/read uses canonical serverUrl hash key');
  it.todo('legacy compatibility: does not silently clobber openhands.sessionApiKey when it differs');
  it.todo('legacy compatibility: writes openhands.sessionApiKey when empty or already matches the per-server token');
  it.todo('delete token: clears per-server token and (when applicable) legacy token');
  it.todo('metadata storage: stores non-secret metadata (obtainedAt, tokenType, expiresAt?) separately');
});

