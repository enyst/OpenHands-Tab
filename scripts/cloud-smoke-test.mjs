#!/usr/bin/env node
/**
 * One-shot OpenHands Cloud smoke test.
 *
 * Safety:
 * - Requires Cloud API key via env var (never read from disk; never printed).
 * - Never prints runtime session key (session_api_key) or any URL containing secrets.
 * - Intended to be run manually a small number of times (no loops).
 *
 * Usage:
 *   OPENHANDS_CLOUD_API_KEY=... node scripts/cloud-smoke-test.mjs
 *
 * Optional env:
 *   OPENHANDS_CLOUD_URL=https://app.all-hands.dev
 *   OPENHANDS_SMOKE_ALLOW_WS_LEGACY=1   # allow fallback to ?session_api_key=... if header-only fails
 */

import WebSocket from 'ws';

function redactSecrets(text, secrets) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const raw = String(secret);
    const enc = encodeURIComponent(raw);
    out = out.split(raw).join('***');
    if (enc !== raw) out = out.split(enc).join('***');
  }
  return out;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function warn(msg) {
  console.warn(`! ${msg}`);
}

function fail(msg, secrets = []) {
  console.error(`✗ ${redactSecrets(msg, secrets)}`);
  process.exitCode = 1;
  throw new Error('cloud-smoke-test failed');
}

function parseNestedConversationUrl(conversationUrl) {
  let url;
  try {
    url = new URL(conversationUrl);
  } catch {
    return null;
  }

  const pathname = url.pathname.replace(/\/$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const conversationsIndex = parts.lastIndexOf('conversations');
  if (conversationsIndex <= 0) return null;
  if (parts[conversationsIndex - 1] !== 'api') return null;
  const id = parts[conversationsIndex + 1];
  if (!id) return null;

  const baseParts = parts.slice(0, conversationsIndex - 1);
  const basePath = baseParts.length ? `/${baseParts.join('/')}` : '';
  const nestedServerUrl = `${url.origin}${basePath}`;
  return { nestedServerUrl, conversationId: id };
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  return { res, json };
}

async function tryWsConnect({ url, headers, label, secretsForRedaction }) {
  return await new Promise((resolve) => {
    let closeInfo = null;
    let opened = false;
    let settled = false;
    let ws;
    let timer;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ...result, closeInfo });
    };

    try {
      ws = new WebSocket(url, { headers });
    } catch (err) {
      void err;
      finalize({ ok: false, label, kind: 'constructor' });
      return;
    }

    timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      finalize({ ok: false, label, kind: 'timeout' });
    }, 8000);

    ws.on('open', () => {
      opened = true;
      try { ws.close(); } catch {}
    });
    ws.on('error', (err) => {
      // Avoid printing error objects (can include URL). Keep it generic.
      void err;
      finalize({ ok: false, label, kind: 'error' });
    });
    ws.on('close', (code, reasonBuf) => {
      const reason = typeof reasonBuf === 'string' ? reasonBuf : Buffer.from(reasonBuf || []).toString('utf8');
      closeInfo = { code, reason: redactSecrets(reason || '', secretsForRedaction).slice(0, 200) };
      finalize({ ok: opened, label, kind: opened ? 'open' : 'close' });
    });
  });
}

async function main() {
  const cloudServerUrl = (process.env.OPENHANDS_CLOUD_URL || 'https://app.all-hands.dev').replace(/\/$/, '');
  const cloudApiKey = (process.env.OPENHANDS_CLOUD_API_KEY || '').trim();
  if (!cloudApiKey) {
    fail('Missing required env var: OPENHANDS_CLOUD_API_KEY');
  }

  const allowWsLegacy = (process.env.OPENHANDS_SMOKE_ALLOW_WS_LEGACY || '') === '1';
  const secretsForRedaction = [cloudApiKey];

  ok('Cloud API key provided via env (value not printed).');

  // 1) V1 bootstrap: stream-start
  const startUrl = `${cloudServerUrl}/api/v1/app-conversations/stream-start`;
  const start = await fetchJson(startUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cloudApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!start.res.ok) {
    fail(`stream-start failed: HTTP ${start.res.status}`, secretsForRedaction);
  }
  if (!Array.isArray(start.json)) {
    fail('stream-start returned non-array JSON', secretsForRedaction);
  }
  ok(`stream-start OK (tasks=${start.json.length}).`);

  const tasks = start.json;
  const ready = [...tasks].reverse().find((t) => t && typeof t === 'object' && t.status === 'READY' && typeof t.app_conversation_id === 'string');
  const appConversationId = (ready?.app_conversation_id || '').trim();
  if (!appConversationId) {
    const err = [...tasks].reverse().find((t) => t && typeof t === 'object' && t.status === 'ERROR');
    const hadErrorDetail = Boolean(err && typeof err.detail === 'string' && err.detail.trim());
    fail(`No READY task in stream-start response${hadErrorDetail ? ' (server returned ERROR detail)' : ''}`, secretsForRedaction);
  }
  ok('Found READY app conversation id (value not printed).');

  // 2) V1 bootstrap: resolve to nested runtime conversation
  const getUrl = `${cloudServerUrl}/api/v1/app-conversations?ids=${encodeURIComponent(appConversationId)}`;
  const get = await fetchJson(getUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cloudApiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!get.res.ok) {
    fail(`app-conversations GET failed: HTTP ${get.res.status}`, secretsForRedaction);
  }
  if (!Array.isArray(get.json) || get.json.length < 1) {
    fail('app-conversations GET returned empty/non-array JSON', secretsForRedaction);
  }
  ok(`app-conversations GET OK (items=${get.json.length}).`);

  const info = get.json.find((c) => c && typeof c === 'object');
  const conversationUrl = typeof info?.conversation_url === 'string' ? info.conversation_url.trim() : '';
  const runtimeSessionApiKey = typeof info?.session_api_key === 'string' ? info.session_api_key.trim() : '';
  if (!conversationUrl) fail('Missing conversation_url in app-conversations response', secretsForRedaction);
  if (!runtimeSessionApiKey) fail('Missing session_api_key in app-conversations response', secretsForRedaction);
  secretsForRedaction.push(runtimeSessionApiKey);
  ok('Received nested runtime conversation_url + session_api_key (values not printed).');

  const parsed = parseNestedConversationUrl(conversationUrl);
  if (!parsed) {
    fail('Could not parse nested conversation URL', secretsForRedaction);
  }
  const { nestedServerUrl, conversationId } = parsed;
  ok(`Parsed nested runtime server (hostname only): ${new URL(nestedServerUrl).hostname}`);

  // 3) Auth check against nested runtime (HTTP). Match RemoteConversation history fetch shape.
  const eventsUrl = `${nestedServerUrl}/api/conversations/${encodeURIComponent(conversationId)}/events/search?limit=1`;
  const events = await fetchJson(eventsUrl, {
    method: 'GET',
    headers: {
      'X-Session-API-Key': runtimeSessionApiKey,
      'Content-Type': 'application/json',
    },
  });
  if (!events.res.ok) {
    fail(`nested runtime events/search GET failed: HTTP ${events.res.status}`, secretsForRedaction);
  }
  ok('Nested runtime HTTP auth OK (GET events/search).');

  // 4) WS connect. Header-only first; optional legacy fallback if enabled.
  const wsBase = nestedServerUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  const wsPath = `/sockets/events/${encodeURIComponent(conversationId)}?resend_all=true`;
  const wsHeaderOnlyUrl = `${wsBase}${wsPath}`;

  const headerAttempt = await tryWsConnect({
    url: wsHeaderOnlyUrl,
    headers: { 'X-Session-API-Key': runtimeSessionApiKey },
    label: 'ws header-only',
    secretsForRedaction,
  });

  if (headerAttempt.ok) {
    ok(`WebSocket connected with header-only auth (closed immediately). close=${headerAttempt.closeInfo?.code ?? 'unknown'}`);
    return;
  }

  warn(`WebSocket header-only failed (kind=${headerAttempt.kind}).`);
  if (!allowWsLegacy) {
    warn('Legacy WS query-param fallback disabled. Set OPENHANDS_SMOKE_ALLOW_WS_LEGACY=1 to try it.');
    return;
  }

  warn('Trying legacy WS query-param once (URL not printed)...');
  const wsLegacyUrl = `${wsHeaderOnlyUrl}&session_api_key=${encodeURIComponent(runtimeSessionApiKey)}`;
  const legacyAttempt = await tryWsConnect({
    url: wsLegacyUrl,
    headers: {},
    label: 'ws legacy query-param',
    secretsForRedaction,
  });
  if (!legacyAttempt.ok) {
    fail(`WebSocket legacy connect failed (kind=${legacyAttempt.kind}).`, secretsForRedaction);
  }
  ok(`WebSocket connected with legacy query-param auth (closed immediately). close=${legacyAttempt.closeInfo?.code ?? 'unknown'}`);
}

await main();
