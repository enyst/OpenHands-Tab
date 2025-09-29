import React, { useEffect, useState } from 'react';
import '@openhands/ui/styles';
import { ToastManager, toasterMessages, Button, Typography } from '@openhands/ui';
import type { Event, MessageEvent, SystemEvent, ErrorEvent, TextContent } from '../../types/agent-sdk';
import { isEvent, isMessageEvent, isTextContent, isSystemEvent, isErrorEvent } from '../../types/agent-sdk';

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  return <span className={`status ${status}`} />;
}

type RenderedMsg = { role: 'user' | 'assistant' | 'tool' | 'system'; content: string };

export function App() {
  const [status, setStatus] = useState<'online'|'offline'|'connecting'>('offline');
  const [messages, setMessages] = useState<RenderedMsg[]>([]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const payload: any = (event as any).data;
      if (payload?.type === 'status') setStatus(payload.status);
      if (payload?.type === 'configUpdated') toasterMessages.info(`Config updated: ${payload.serverUrl}`);
      if (payload?.type === 'event') handleEvent(payload.event);
      if (payload?.type === 'error') setMessages((m) => [...m, { role: 'system', content: String(payload.error) }]);
    };
    window.addEventListener('message', handler as any);
    return () => window.removeEventListener('message', handler as any);
  }, []);

  useEffect(() => {
    if (status === 'connecting') toasterMessages.info('Connecting...');
    if (status === 'online') toasterMessages.success('Connected to server');
    if (status === 'offline') toasterMessages.warning('Disconnected');
  }, [status]);

  function handleEvent(e: unknown) {
    if (!isEvent(e)) return;
    if (isMessageEvent(e)) {
      const parts = (e.message.content || []).filter(isTextContent).map(c => c.text);
      if (parts.length) {
        const role = e.message.role === 'user' ? 'user' : 'assistant';
        setMessages(m => [...m, { role, content: parts.join('\n') }]);
      }
      return;
    }
    if (isSystemEvent(e)) {
      setMessages(m => [...m, { role: 'system', content: e.message }]);
      toasterMessages.info(e.message);
      return;
    }
    if (isErrorEvent(e)) {
      setMessages(m => [...m, { role: 'system', content: `Error: ${e.error}` }]);
      toasterMessages.error(e.error);
      return;
    }
    setMessages(m => [...m, { role: 'tool', content: e.type }]);
  }

  function postMessage(msg: any) { (window as any).acquireVsCodeApi?.().postMessage(msg); }

  const [input, setInput] = useState('');
  return (
    <div id="app">
      <ToastManager />
      <header>
        <StatusDot status={status} />
        <Typography.H1>OpenHands</Typography.H1>
        <Button onClick={() => postMessage({ type: 'openSettings' })}>Settings</Button>
      </header>
      <main id="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
      </main>
      <footer>
        <textarea id="input" rows={2} placeholder="Type a message..." value={input} onChange={e => setInput(e.target.value)} />
        <Button id="sendBtn" onClick={() => { const text = input.trim(); if (text) { setMessages(m => [...m, { role: 'user', content: text }]); setInput(''); postMessage({ type: 'send', text }); } }}>Send</Button>
        <Button id="stopBtn" onClick={() => postMessage({ type: 'command', command: 'pause' })}>Stop</Button>
      </footer>
    </div>
  );
}
