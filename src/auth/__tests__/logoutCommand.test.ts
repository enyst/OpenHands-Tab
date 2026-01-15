import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI logout command tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_logout_command.py`
 */
describe('Logout command (extension host) - ported scenarios', () => {
  it.todo('logout clears per-server token and leaves other servers untouched');
  it.todo('logout clears legacy openhands.sessionApiKey only when it matches the cleared server token');
  it.todo('logout updates UI state (logged-in indicator) without leaking tokens');
});

