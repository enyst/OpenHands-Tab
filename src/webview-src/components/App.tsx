import React, { useEffect, useState } from 'react';
import '@openhands/ui/styles';
import '../vendor/openhands-ui-tokens-plain.css';
import { ToastManager, toasterMessages, Button, Typography, Scrollable, Input } from '@openhands/ui';
import type { Event, MessageEvent as VscodeMessageEvent, SystemEvent, ErrorEvent, TextContent } from '../../types/agent-sdk';
import { isEvent, isMessageEvent, isTextContent, isSystemEvent, isErrorEvent } from '../../types/agent-sdk';

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  const colorClass = status === 'online'
    ? 'bg-[var(--color-green-600)]'
    : status === 'offline'
      ? 'bg-[var(--color-red-600)]'
      : 'bg-[var(--color-primary-500)]';
  return <span className={`inline-block w-[10px] h-[10px] rounded-full mr-2 align-middle ${colorClass}`} />;
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
    <div id="app" className="flex flex-col h-screen">
      <ToastManager />
      <header className="flex items-center gap-2 px-3 py-2 border-b border-black/10">
        <StatusDot status={status} />
        <Typography.H1>OpenHands</Typography.H1>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => { toasterMessages.info('Opening settings...'); postMessage({ type: 'openSettings' }); }}>Settings</Button>
          <Button onClick={() => { toasterMessages.info('Reconnecting...'); postMessage({ type: 'command', command: 'reconnect' }); }}>Reconnect</Button>
          <Button onClick={() => { toasterMessages.info('Starting new conversation...'); postMessage({ type: 'command', command: 'startNewConversation' }); }}>New Chat</Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 px-3 py-2">
        <Scrollable mode="auto" type="vertical" className="flex-1 min-h-0 rounded border border-black/10 p-2" tabIndex={0}>
          {messages.map((m, i) => (
            <div key={i} className={`whitespace-pre-wrap p-2 rounded my-1 ${m.role === 'user' ? 'bg-[rgba(0,120,212,0.08)] border border-[rgba(0,120,212,0.2)]' : m.role === 'assistant' ? 'bg-[rgba(0,200,0,0.06)] border border-[rgba(0,200,0,0.18)]' : m.role === 'tool' ? 'bg-[rgba(128,128,128,0.06)] border-l-[3px] border-[rgba(128,128,128,0.6)] font-mono' : 'italic text-[var(--vscode-descriptionForeground)]'}`}>{m.content}</div>
          ))}
        </Scrollable>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-black/10">
        <Input
          label="Message"
          placeholder="Type a message..."
          value={input}
          onChange={(e: any) => setInput(e.target.value)}
          onKeyDown={(e: any) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } }}
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
