// React must be in scope for JSX to work after esbuild transpilation
// @ts-expect-error - TS6133: React appears unused but is required for JSX runtime
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
// Global CSS now linked via HTML (media/index.css). No CSS imports here.

// --- Webview instrumentation: bridge console/errors/network to extension host ---
(function initInstrumentation() {
  try {
    const post = (payload: any) => {
      try { (globalThis as any).__OH_VSCODE_API__?.postMessage(payload); } catch {}
    };

    // Signal readiness (in case the host waits on it)
    post({ type: 'webviewReady' });

    // Console bridge
    const levels: Array<'log' | 'warn' | 'error'> = ['log', 'warn', 'error'];
    levels.forEach((level) => {
      const orig = (console as any)[level]?.bind(console);
      (console as any)[level] = (...args: unknown[]) => {
        try { post({ type: 'webviewConsole', level, args: args.map(String) }); } catch {}
        try { orig?.(...args); } catch {}
      };
    });

    // Uncaught errors
    window.addEventListener('error', (e) => {
      post({ type: 'webviewError', message: e.message, stack: (e as any).error?.stack });
    });
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      post({ type: 'webviewError', message: 'unhandledrejection', stack: String(e.reason) });
    });

    // fetch wrapper
    const origFetch = window.fetch.bind(window);
    type FetchParams = Parameters<typeof window.fetch>;
    (window as any).fetch = async (...args: FetchParams) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const [input, init] = args;
        const method = ((init as any)?.method) || ((input as any)?.method) || 'GET';
        const url = (typeof input === 'string' || input instanceof URL) ? String(input) : (((input as any)?.url) ?? String(input));
        post({ type: 'webviewNetwork', phase: 'request', id, method, url });
        const res: Response = await origFetch(input as any, init as any);
        post({ type: 'webviewNetwork', phase: 'response', id, status: res.status, ok: res.ok });
        return res;
      } catch (err) {
        post({ type: 'webviewNetwork', phase: 'error', id, error: String(err) });
        throw err;
      }
    };

    // WebSocket wrapper (basic lifecycle logging)
    const OrigWS = (window as any).WebSocket;
    (window as any).WebSocket = function(url: string | URL, protocols?: string | string[]) {
      const ws = new OrigWS(url, protocols);
      try { post({ type: 'webviewWebSocket', phase: 'created', url: String(url) }); } catch {}
      try {
        ws.addEventListener('open', () => post({ type: 'webviewWebSocket', phase: 'open', url: String(url) }));
        ws.addEventListener('close', (e: CloseEvent) => post({ type: 'webviewWebSocket', phase: 'close', code: e.code, reason: e.reason }));
        ws.addEventListener('error', () => post({ type: 'webviewWebSocket', phase: 'error' }));
      } catch {}
      return ws;
    } as any;
    (window as any).WebSocket.prototype = OrigWS.prototype;
  } catch {}
})();
// --- End instrumentation ---

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('Failed to find app element');
}
const root = createRoot(appElement);
root.render(<App />);
