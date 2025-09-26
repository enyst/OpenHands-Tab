type VSCodeApi = { postMessage: (msg: any) => void, getState: () => any, setState: (s: any) => void };
// @ts-ignore
const vscode: VSCodeApi = acquireVsCodeApi();

const state: {
  serverUrl: string;
  status: 'online' | 'offline' | 'connecting';
  messages: Array<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: string }>;
} = { serverUrl: 'http://localhost:3000', status: 'offline', messages: [] };

const statusEl = document.getElementById('status') as HTMLSpanElement;
const messagesEl = document.getElementById('messages') as HTMLDivElement;
const inputEl = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

function setStatus(s: 'online' | 'offline' | 'connecting') {
  state.status = s;
  statusEl.className = `status ${s}`;
}

function appendMessage(role: 'user' | 'assistant' | 'tool' | 'system', content: string) {
  state.messages.push({ role, content });
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function loadConfigFromVSCode() {
  vscode.postMessage({ type: 'getConfig' });
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'config') {
    state.serverUrl = msg.serverUrl || 'http://localhost:3000';
  } else if (msg?.type === 'configUpdated') {
    state.serverUrl = msg.serverUrl || state.serverUrl;
  } else if (msg?.type === 'status') {
    setStatus(msg.status);
  } else if (msg?.type === 'event') {
    const ev = msg.event;
    // Prefer agent-sdk shapes (kind + llm_message)
    if (ev?.kind === 'MessageEvent' || ev?.type === 'message') {
      let role: 'user' | 'assistant' = 'assistant';
      let text = '';
      if (ev?.llm_message) {
        role = (ev.llm_message.role === 'user' || ev.source === 'user') ? 'user' : 'assistant';
        const content = Array.isArray(ev.llm_message.content) ? ev.llm_message.content : [];
        text = content.filter((c: any) => c && c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n');
      } else {
        role = (ev?.role === 'user') ? 'user' : 'assistant';
        text = ev?.content || '';
      }
      if (text) appendMessage(role, text);
    } else if (ev) {
      // Tool/Action/Log rendering (best-effort)
      const title = ev.kind || ev.type || 'event';
      const name = ev.name || ev.command || ev.tool || '';
      const output = ev.output || ev.stdout || ev.stderr || ev.log || ev.logs || '';
      const header = [title, name].filter(Boolean).join(' · ');
      if (output && typeof output === 'string') {
        appendMessage('tool', `${header}\n${output}`);
      } else {
        appendMessage('tool', header || JSON.stringify(ev));
      }
    }
  } else if (msg?.type === 'error') {
    appendMessage('system', `Error: ${msg.error}`);
  }
});

sendBtn.addEventListener('click', async () => {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  appendMessage('user', text);
  vscode.postMessage({ type: 'send', text });
});

stopBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'command', command: 'pause' });
});

settingsBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'openSettings' });
});

(function init() {
  loadConfigFromVSCode();
})();
