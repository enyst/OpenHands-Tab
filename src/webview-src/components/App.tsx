import React, { useEffect, useState } from 'react';
import '@openhands/ui/styles';
import { ToastManager, toasterMessages, Button, Typography, Scrollable, Input } from '@openhands/ui';
import type { Event, MessageEvent as VscodeMessageEvent, SystemEvent, ErrorEvent, TextContent } from '../../types/agent-sdk';
import { isEvent, isMessageEvent, isTextContent, isSystemEvent, isErrorEvent } from '../../types/agent-sdk';

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  return <span className={`status ${status}`} />;
}

type RenderedMsg = { role: 'user' | 'assistant' | 'tool' | 'system'; content: string };

export function App() {
  const [status, setStatus] = useState<'online'|'offline'|'connecting'>('offline');
  const [messages, setMessages] = useState<RenderedMsg[]>([]);

  useEffect(() => {
    console.debug('[webview] App mounted');
    const handler = (event: MessageEvent) => {
      const payload: any = (event as any).data;
      console.debug('[webview] message from extension', payload?.type, payload);
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
  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages(m => [...m, { role: 'user', content: text }]);
    setInput('');
    postMessage({ type: 'send', text });
  };

  return (
    <div id="app" className="oh-container">
      <ToastManager />
      <header className="oh-header">
        <StatusDot status={status} />
        <Typography.H1>OpenHands</Typography.H1>
        <div className="oh-header-actions">
          <Button onClick={() => { toasterMessages.info('Opening settings...'); postMessage({ type: 'openSettings' }); }}>Settings</Button>
          <Button onClick={() => { toasterMessages.info('Reconnecting...'); postMessage({ type: 'command', command: 'reconnect' }); }}>Reconnect</Button>
          <Button onClick={() => { toasterMessages.info('Starting new conversation...'); postMessage({ type: 'command', command: 'startNewConversation' }); }}>New Chat</Button>
        </div>
      </header>

      <div className="oh-content">
        <Scrollable mode="auto" type="vertical" className="oh-messages" tabIndex={0}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>{m.content}</div>
          ))}
        </Scrollable>
      </div>

      <div className="oh-composer">
        <textarea
          id="input"
          rows={3}
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }}
        />
        <div className="oh-actions">
          <Button id="sendBtn" onClick={send}>Send</Button>
          <Button id="stopBtn" variant="secondary" onClick={() => postMessage({ type: 'command', command: 'pause' })}>Stop</Button>
        </div>
      </div>
    </div>
  );
}
