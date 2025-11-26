// React must be in scope for JSX to work after esbuild transpilation
// @ts-expect-error - TS6133: React appears unused but is required for JSX runtime
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { getVscodeApi } from './shared/vscodeApi';
// Global CSS now linked via HTML (media/index.css). No CSS imports here.

// --- Webview instrumentation: bridge console/errors/network to extension host ---
(function initInstrumentation() {
  try {
    const api = getVscodeApi();
    const post = (payload: unknown) => {
      try { api.postMessage(payload); } catch {}
    };

    // Signal readiness (in case the host waits on it)
    post({ type: 'webviewReady' });

    // Console bridge
    const levels: Array<'log' | 'warn' | 'error'> = ['log', 'warn', 'error'];
    levels.forEach((level) => {
      const orig = console[level]?.bind(console);
      console[level] = (...args: unknown[]) => {
        try { post({ type: 'webviewConsole', level, args: args.map(String) }); } catch {}
        try { orig?.(...args); } catch {}
      };
    });

    // Uncaught errors
    window.addEventListener('error', (e) => {
      post({ type: 'webviewError', message: e.message, stack: e.error instanceof Error ? e.error.stack : undefined });
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      post({ type: 'webviewError', message: 'unhandledrejection', stack: String(e.reason) });
    });

    // fetch wrapper
    const origFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (...args) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const [input, init] = args;
        const method =
          (init && 'method' in init && typeof init.method === 'string' && init.method) ||
          (input instanceof Request && typeof input.method === 'string' ? input.method : 'GET');
        const url =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input instanceof Request && typeof input.url === 'string'
              ? input.url
              : '[unknown]';
        post({ type: 'webviewNetwork', phase: 'request', id, method, url });
        const res = await origFetch(...args);
        post({ type: 'webviewNetwork', phase: 'response', id, status: res.status, ok: res.ok });
        return res;
      } catch (err) {
        post({ type: 'webviewNetwork', phase: 'error', id, error: String(err) });
        throw err;
      }
    };
    window.fetch = wrappedFetch;

    // WebSocket wrapper (basic lifecycle logging)
    const OrigWS = window.WebSocket;
    class InstrumentedWebSocket extends OrigWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        try { post({ type: 'webviewWebSocket', phase: 'created', url: String(url) }); } catch {}
        try {
          this.addEventListener('open', () => post({ type: 'webviewWebSocket', phase: 'open', url: String(url) }));
          this.addEventListener('close', (e: CloseEvent) =>
            post({ type: 'webviewWebSocket', phase: 'close', code: e.code, reason: e.reason })
          );
          this.addEventListener('error', () => post({ type: 'webviewWebSocket', phase: 'error' }));
        } catch {}
      }
    }
    window.WebSocket = InstrumentedWebSocket as typeof window.WebSocket;
  } catch {}
})();
// --- End instrumentation ---

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('Failed to find app element');
}
const root = createRoot(appElement);
root.render(<App />);
