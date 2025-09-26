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
    const data = msg.event;
    if (data?.type === 'message') {
      appendMessage(data.role || 'assistant', data.content || '');
    } else if (data?.type) {
      const payload = `[${data.type}] ${data.name || ''} ${data.command || ''} ${data.output || ''}`.trim();
      appendMessage('tool', payload);
    } else {
      appendMessage('system', JSON.stringify(data));
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
