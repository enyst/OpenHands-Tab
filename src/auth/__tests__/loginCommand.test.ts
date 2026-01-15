import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI login command tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_login_command.py`
 *
 * Note: For oh-tab this should become extension-host command coverage + E2E.
 */
describe('Login command (extension host) - ported scenarios', () => {
  it.todo('command triggers device flow and stores token for selected server');
  it.todo('if CLI token file is present, prompts user to import and validates before storing');
  it.todo('on 401/403 during remote connect, host prompts to login and retries after success');
});

