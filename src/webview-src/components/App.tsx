import React, { useEffect, useState } from 'react';
import '@openhands/ui/styles';

function StatusDot({ status }: { status: 'online' | 'offline' | 'connecting' }) {
  return <span className={`status ${status}`} />;
}

export function App() {
  const [status, setStatus] = useState<'online'|'offline'|'connecting'>('offline');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: string }>>([]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg: any = event.data;
      if (msg?.type === 'status') setStatus(msg.status);
      if (msg?.type === 'event') {
        const ev = msg.event;
        if (ev?.type === 'message' && ev.message?.content) {
          const text = (ev.message.content || [])
            .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text)
            .join('\n');
          if (text) setMessages((m) => [...m, { role: ev.message.role === 'user' ? 'user' : 'assistant', content: text }]);
        } else {
          const title = ev?.kind || ev?.type || 'event';
          setMessages((m) => [...m, { role: 'tool', content: title }]);
        }
      }
      if (msg?.type === 'error') setMessages((m) => [...m, { role: 'system', content: String(msg.error) }]);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  function postMessage(msg: any) { (window as any).acquireVsCodeApi?.().postMessage(msg); }

  const [input, setInput] = useState('');
  return (
    <div id="app">
      <header>
        <StatusDot status={status} />
        <h1>OpenHands</h1>
        <button onClick={() => postMessage({ type: 'openSettings' })}>Settings</button>
      </header>
      <main id="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
      </main>
      <footer>
        <textarea id="input" rows={2} placeholder="Type a message..." value={input} onChange={e => setInput(e.target.value)} />
        <button id="sendBtn" onClick={() => { const text = input.trim(); if (text) { setMessages(m => [...m, { role: 'user', content: text }]); setInput(''); postMessage({ type: 'send', text }); } }}>Send</button>
        <button id="stopBtn" onClick={() => postMessage({ type: 'command', command: 'pause' })}>Stop</button>
      </footer>
    </div>
  );
}
