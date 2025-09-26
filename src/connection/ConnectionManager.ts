import * as vscode from 'vscode';
import WebSocket from 'ws';

export type ConnectionEvents = {
  onStatus: (status: 'online' | 'offline' | 'connecting') => void;
  onEvent: (event: any) => void;
  onError: (err: any) => void;
};

export class ConnectionManager {
  private serverUrl: string;
  private conversationId?: string;
  private ws?: WebSocket;
  private status: 'online' | 'offline' | 'connecting' = 'offline';
  private events: ConnectionEvents;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(serverUrl: string, events: ConnectionEvents) {
    this.serverUrl = serverUrl;
    this.events = events;
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
  }

  getConversationId() { return this.conversationId; }

  async startNewConversation() {
    try {
      const res = await fetch(this.serverUrl + '/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: 'default',
          confirmation_policy: { policy: 'NeverConfirm' },
          max_iterations: 50
        })
      } as any);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      this.conversationId = json.id || json.conversation_id || json.uuid;
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
    try { await fetch(`${this.serverUrl}/api/conversations/${this.conversationId}/pause`, { method: 'POST' } as any); } catch (e) { this.events.onError(e); }
  }

  async resume() {
    if (!this.conversationId) return;
    try { await fetch(`${this.serverUrl}/api/conversations/${this.conversationId}/resume`, { method: 'POST' } as any); } catch (e) { this.events.onError(e); }
  }

  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      await this.startNewConversation();
    }
    const payload = { type: 'message', role: 'user', content: text };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      try {
        await fetch(`${this.serverUrl}/api/conversations/${this.conversationId}/events/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
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
    this.reconnectTimer = setTimeout(() => this.connect(), 1500);
  }

  private connect() {
    if (!this.conversationId) return;
    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + `/api/conversations/${this.conversationId}/events/socket`;
    this.setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => this.setStatus('online'));
    ws.on('close', () => { this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('error', (err) => { this.events.onError(err); this.setStatus('offline'); });
    ws.on('message', (buf) => {
      try {
        const str = buf.toString();
        const data = JSON.parse(str);
        this.events.onEvent(data);
      } catch (e) {
        this.events.onEvent({ type: 'raw', data: buf.toString() });
      }
    });
  }
}
