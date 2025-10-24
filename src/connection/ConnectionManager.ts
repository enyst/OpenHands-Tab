import WebSocket from 'ws';
import type { Event, Message } from '../types/agent-sdk';
import { isEvent as isAgentEvent } from '../types/agent-sdk';
import type { OpenHandsSettings } from '../settings/SettingsManager';

export type ConnectionEvents = {
  onStatus: (status: 'online' | 'offline' | 'connecting') => void;
  onEvent: (event: Event) => void;
  onError: (err: any) => void;
  onConversationId?: (id: string | undefined) => void;
};

export class ConnectionManager {
  private serverUrl: string;
  private settings?: OpenHandsSettings;
  private conversationId?: string;
  private ws?: WebSocket;
  private status: 'online' | 'offline' | 'connecting' = 'offline';
  private events: ConnectionEvents;
  private reconnectTimer?: NodeJS.Timeout;
  // Reserved for future use if server pathing requires '/api' prefix toggling.
  // private useApiPrefix = true;
  private retryCount = 0;
  private readonly retryBaseMs = 1000;
  private readonly retryMaxMs = 15000;

  constructor(serverUrl: string, events: ConnectionEvents) {
    this.serverUrl = serverUrl;
    this.events = events;
  }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
  }

  // setApiPrefix(enabled: boolean) {
  //   this.useApiPrefix = enabled;
  // }

  getConversationId() { return this.conversationId; }
  getStatus() { return this.status; }

  async startNewConversation() {
    try {
      const base = this.serverUrl.replace(/\/$/, '');
      const s = this.settings;
      const req = {
        agent: {
          llm: {
            usage_id: s?.llm.usageId || 'default-llm',
            model: s?.llm.model || 'claude-sonnet-4-20250514',
            base_url: s?.llm.baseUrl,
            api_key: s?.secrets.llmApiKey
          },
          tools: [
            { name: 'BashTool', params: { working_dir: process.cwd() } },
            { name: 'FileEditorTool', params: { workspace_root: process.cwd() } },
            { name: 'TaskTrackerTool', params: { save_dir: process.cwd() } }
          ],
          security_analyzer: s?.agent.enableSecurityAnalyzer ? { kind: 'LLMSecurityAnalyzer' } : undefined,
          filter_tools_regex: s?.agent.filterToolsRegex ?? undefined,
        },
        max_iterations: 50
      };
      const headers: any = { 'Content-Type': 'application/json' };
      const sessionKey = s?.secrets.sessionApiKey || '';
      if (sessionKey) headers['X-Session-API-Key'] = sessionKey;
      const res = await fetch(base + '/api/conversations/', {
        method: 'POST',
        headers,
        body: JSON.stringify(req)
      } as any);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      this.conversationId = json.id || json.conversation_id || json.uuid;
      this.events.onConversationId?.(this.conversationId);
      this.connect();
      return this.conversationId;
    } catch (e) {
      this.events.onError(e);
      return undefined;
    }
  }

  async restoreConversation(id: string) {
    this.conversationId = id;
    this.connect();
  }

  async pause() {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    try { await fetch(`${base}/api/conversations/${this.conversationId}/pause`, { method: 'POST' } as any); } catch (e) { this.events.onError(e); }
  }

  async resume() {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    try { await fetch(`${base}/api/conversations/${this.conversationId}/resume`, { method: 'POST' } as any); } catch (e) { this.events.onError(e); }
  }

  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      await this.startNewConversation();
    }
    // agent-sdk expects content to be an array of TextContent objects
    const payload: Message = { role: 'user', content: [{ type: 'text', text }] };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      try {
        const base = this.serverUrl.replace(/\/$/, '');
        const headers: any = { 'Content-Type': 'application/json' };
        const sessionKey = this.settings?.secrets.sessionApiKey || '';
        if (sessionKey) headers['X-Session-API-Key'] = sessionKey;
        await fetch(`${base}/api/conversations/${this.conversationId}/events/`, {
          method: 'POST', headers, body: JSON.stringify(payload)
        } as any);
      } catch (e) { this.events.onError(e); }
    }
  }

  disconnect() {
    this.clearReconnect();
    if (this.ws) { try { this.ws.close(); } catch {}
    }
    this.setStatus('offline');
  }

  reconnect() {
    if (this.conversationId) this.connect();
  }

  private setStatus(s: 'online' | 'offline' | 'connecting') {
    this.status = s;
    this.events.onStatus(s);
  }

  private clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const delay = Math.min(this.retryMaxMs, Math.floor(this.retryBaseMs * Math.pow(2, this.retryCount)));
    this.retryCount = Math.min(this.retryCount + 1, 10);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private connect() {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    const sessionKey = this.settings?.secrets.sessionApiKey || '';
    // agent-sdk WS path moved to /sockets/events/{conversation_id} with optional session_api_key
    const qs = sessionKey ? `?session_api_key=${encodeURIComponent(sessionKey)}` : '';
    const wsUrl = base.replace(/^http/, 'ws') + `/sockets/events/${this.conversationId}${qs}`;
    this.setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => { this.retryCount = 0; this.setStatus('online'); });
    ws.on('close', () => { this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('error', (err) => { this.events.onError(err); this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('message', (buf) => {
      try {
        const str = buf.toString();
        const data = JSON.parse(str);
        if (isAgentEvent(data)) this.events.onEvent(data);
        else this.events.onError(new Error('Invalid event payload'));
      } catch (e) {
        this.events.onError(e);
      }
    });
  }
}
