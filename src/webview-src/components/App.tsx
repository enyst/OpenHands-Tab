import React, { useEffect, useRef, useState } from 'react';
/*
  App.tsx hygiene improvements:
  - Cache VS Code API once
  - Debounce/suppress toasts
  - Stable keys for messages
  - Enter to send; Shift+Enter newline
  - Deterministic scroll with sentinel
  - A11y roles
*/

import { ToastManager, Button, Typography, Scrollable, Input } from '@openhands/ui';
import { isEvent, isMessageEvent, isTextContent, isSystemEvent, isErrorEvent } from '../../types/agent-sdk';

const vscodeApi = (typeof window !== 'undefined' && (window as any).acquireVsCodeApi)
  ? (window as any).acquireVsCodeApi()
  : { postMessage: (_: any) => {} };

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  const colorClass = status === 'online'
    ? 'bg-[var(--color-green-600)]'
    : status === 'offline'
      ? 'bg-[var(--color-red-600)]'
      : 'bg-[var(--color-primary-500)]';
  return (
    <span
      aria-label={`Connection status: ${status}`}
      className={`inline-block w-[10px] h-[10px] rounded-full mr-2 align-middle ${colorClass}`}
    />
  );
}

type RenderedMsg = { id: number; role: 'user' | 'assistant' | 'tool' | 'system'; content: string };

function ToolEventBlock({ event }: { event: any }) {
  const title = event?.type || event?.kind || 'event';
  const name = event?.name || event?.command || event?.tool || '';
  const output = event?.output || event?.stdout || event?.stderr || event?.log || event?.logs || '';
  const [expanded, setExpanded] = useState(false);
  const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  const tooLong = text.length > 2000;
  const shown = expanded || !tooLong ? text : text.slice(0, 2000) + '\n…';
  return (
    <div className="bg-[rgba(128,128,128,0.06)] border-l-[3px] border-[rgba(128,128,128,0.6)] font-mono p-2 rounded my-1">
      <div className="font-semibold mb-1 text-[var(--vscode-foreground)]">
        {title}{name ? ' · ' : ''}
        {name ? (
          <span className="ml-2 inline-block px-2 py-[1px] rounded-full bg-black/10 text-xs align-middle">{name}</span>
        ) : null}
      </div>
      {text ? (
        <>
          <div className="whitespace-pre-wrap">{shown}</div>
          {tooLong && (
            <button
              className="text-[var(--vscode-textLink-foreground)] text-xs mt-1"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

const TOAST_DEBOUNCE_MS = 600;
let lastToast = { type: '' as '' | 'info' | 'success' | 'warning' | 'error', at: 0 };
function toastDebounced(type: 'info' | 'success' | 'warning' | 'error', msg: string) {
  const now = Date.now();
  if (lastToast.type === type && now - lastToast.at < TOAST_DEBOUNCE_MS) return;
  lastToast = { type, at: now };
  // Defer to future toast API from @openhands/ui; for now just log as info to avoid unused import.
  console.info(`[toast:${type}]`, msg);
}

function safeJsonParse(s: string) {
  try { return JSON.parse(s); } catch { return { type: 'event', value: s }; }
}

export function App() {
  const [status, setStatus] = useState<'online' | 'offline' | 'connecting'>('offline');
  const [messages, setMessages] = useState<RenderedMsg[]>([]);
  const msgId = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastStatusRef = useRef<'online' | 'offline' | 'connecting' | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload: any = (event as any).data;
      if (payload?.type === 'status') setStatus(payload.status);
      if (payload?.type === 'configUpdated') toastDebounced('info', `Config updated: ${payload.serverUrl}`);
      if (payload?.type === 'event') handleEvent(payload.event);
      if (payload?.type === 'error') setMessages((m) => [...m, { id: msgId.current++, role: 'system', content: String(payload.error) }]);
    };
    window.addEventListener('message', handler as any);
    return () => window.removeEventListener('message', handler as any);
  }, []);

  useEffect(() => {
    // Suppress initial toast; debounce subsequent status changes
    if (lastStatusRef.current === null) {
      lastStatusRef.current = status;
      return;
    }
    if (status === 'connecting') toastDebounced('info', 'Connecting...');
    if (status === 'online') toastDebounced('success', 'Connected to server');
    if (status === 'offline') toastDebounced('warning', 'Disconnected');
    lastStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    // Deterministic scroll to bottom when messages change
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  function handleEvent(e: unknown) {
    if (!isEvent(e)) return;
    if (isMessageEvent(e)) {
      const parts = (e.message.content || []).filter(isTextContent).map((c) => c.text);
      if (parts.length) {
        const role = e.message.role === 'user' ? 'user' : 'assistant';
        setMessages((m) => [...m, { id: msgId.current++, role, content: parts.join('\n') }]);
      }
      return;
    }
    if (isSystemEvent(e)) {
      setMessages((m) => [...m, { id: msgId.current++, role: 'system', content: e.message }]);
      toastDebounced('info', e.message);
      return;
    }
    if (isErrorEvent(e)) {
      setMessages((m) => [...m, { id: msgId.current++, role: 'system', content: `Error: ${e.error}` }]);
      toastDebounced('error', e.error);
      return;
    }
    setMessages((m) => [...m, { id: msgId.current++, role: 'tool', content: JSON.stringify(e) }]);
  }

  function postMessage(msg: any) {
    vscodeApi.postMessage(msg);
  }

  const [input, setInput] = useState('');
  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { id: msgId.current++, role: 'user', content: text }]);
    setInput('');
    postMessage({ type: 'send', text });
  };

  return (
    <div id="app" className="flex flex-col h-screen">
      <ToastManager />
      <header className="flex items-center gap-2 px-3 py-2 border-b border-black/10">
        <StatusDot status={status} />
        <Typography.H1>OpenHands</Typography.H1>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => { toastDebounced('info', 'Opening settings...'); postMessage({ type: 'openSettings' }); }}>Settings</Button>
          <Button onClick={() => { toastDebounced('info', 'Reconnecting...'); postMessage({ type: 'command', command: 'reconnect' }); }}>Reconnect</Button>
          <Button onClick={() => { toastDebounced('info', 'Starting new conversation...'); postMessage({ type: 'command', command: 'startNewConversation' }); }}>New Chat</Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 px-3 py-2">
        <Scrollable
          mode="auto"
          type="vertical"
          className="flex-1 min-h-0 rounded border border-black/10 p-2"
          tabIndex={0}
          aria-label="Conversation messages"
          role="log"
          aria-live="polite"
        >
          {messages.map((m) => (
            <div key={m.id}>
              {m.role === 'tool' ? (
                <ToolEventBlock event={safeJsonParse(m.content)} />
              ) : (
                <div
                  className={`whitespace-pre-wrap p-2 rounded my-1 ${m.role === 'user'
                    ? 'bg-[rgba(0,120,212,0.08)] border border-[rgba(0,120,212,0.2)]'
                    : m.role === 'assistant'
                      ? 'bg-[rgba(0,200,0,0.06)] border border-[rgba(0,200,0,0.18)]'
                      : 'italic text-[var(--vscode-descriptionForeground)]'}`}
                >
                  {m.content}
                </div>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </Scrollable>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-black/10">
        <Input
          label="Message"
          placeholder="Type a message..."
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button id="sendBtn" onClick={send}>Send</Button>
          <Button id="stopBtn" variant="secondary" onClick={() => postMessage({ type: 'command', command: 'pause' })}>Stop</Button>
        </div>
      </div>
    </div>
  );
}
