import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI HTTP client tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_http_client.py`
 *
 * Note: These are intentionally `it.todo(...)` until the auth HTTP helpers exist.
 */
describe('Auth HTTP client helpers - ported scenarios', () => {
  it.todo('adds required headers (Content-Type, auth headers when present)');
  it.todo('handles non-2xx responses: parse JSON error payload when present, otherwise include raw text');
  it.todo('handles invalid JSON error bodies gracefully');
  it.todo('timeouts: aborts request after configured duration');
  it.todo('URL normalization: accepts ws:// and wss:// and normalizes to http(s):// base');
});

