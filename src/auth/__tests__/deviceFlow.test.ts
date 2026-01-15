import { describe, it } from 'vitest';

/**
 * Port plan for OpenHands-CLI device flow tests.
 *
 * Source: OpenHands-CLI `tests/auth/test_device_flow.py`
 *
 * Note: These are intentionally `it.todo(...)` until `oh-tab-voc.3` implements
 * the host-side device-flow client/service.
 */
describe('OAuth Device Flow (host-side) - ported scenarios', () => {
  it.todo('startDeviceFlow: POST /oauth/device/authorize and return { device_code, user_code, verification_uri(_complete), interval }');
  it.todo('pollForToken: handles authorization_pending by polling until success/timeout');
  it.todo('pollForToken: handles slow_down by backing off (increase interval) and continuing');
  it.todo('pollForToken: fails on expired_token and instructs user to restart login');
  it.todo('pollForToken: fails on access_denied when user rejects');
  it.todo('pollForToken: parses error + error_description for unknown errors and surfaces a useful message');
  it.todo('pollForToken: supports user cancel (VS Code progress cancel) and stops polling');
  it.todo('pollForToken: respects a hard timeout (e.g. 10 minutes default)');
  it.todo('verification URL building: preserves existing query params and sets user_code safely');
  it.todo('token exchange payload: includes grant_type=urn:ietf:params:oauth:grant-type:device_code and device_code');
});

