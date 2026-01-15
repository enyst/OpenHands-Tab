import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI API client tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_api_client.py`
 *
 * Note: In oh-tab, these map to remote agent-server calls and (optionally) cloud "sync" calls after login.
 */
describe('Post-auth API calls - ported scenarios', () => {
  it.todo('validates imported CLI token via a cheap authenticated endpoint (e.g. GET /api/user/info)');
  it.todo('optional settings sync: GET /api/settings (if we keep CLI parity)');
  it.todo('handles 401/403 with a typed/auth-shaped error suitable for host-side prompting');
});

