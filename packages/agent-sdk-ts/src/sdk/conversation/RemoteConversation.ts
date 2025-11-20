import EventEmitter from 'events';
import WebSocket from 'ws';
import type { BashEvent, Event, Message } from '../types';
import { isEvent as isAgentEvent } from '../types';
import type { OpenHandsSettings } from '../types/settings';

export type ConversationStatus = 'online' | 'offline' | 'connecting';

interface ConversationHistoryPage {
  items?: unknown[];
  next_page_id?: string | null;
}

export interface RemoteConversationOptions {
  serverUrl: string;
  settings: OpenHandsSettings;
  workspaceRoot?: string;
  conversationId?: string;
}

export type RemoteConversationEventMap = {
  status: (status: ConversationStatus) => void;
  event: (event: Event) => void;
  error: (err: unknown) => void;
  conversationStarted: (id: string) => void;
  terminal: (event: BashEvent) => void;
};

export class RemoteConversation extends EventEmitter {
  private serverUrl: string;
  private settings: OpenHandsSettings;
  private conversationId?: string;
  private status: ConversationStatus = 'offline';
  private readonly seenEventIds = new Set<string>();
  private ws?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retryCount = 0;
  private readonly retryBaseMs = 1000;
  private readonly retryMaxMs = 15000;
  private readonly workspaceRoot: string;
  private static readonly historyPageLimit = 100;

  constructor(options: RemoteConversationOptions) {
    super();
    this.serverUrl = options.serverUrl;
    this.settings = options.settings;
    this.workspaceRoot = options.workspaceRoot ?? (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot ?? process.cwd();
    if (options.conversationId) {
      this.conversationId = options.conversationId;
      this.seenEventIds.clear();
      this.emit('conversationStarted', this.conversationId);
      void this.replayHistory().then(() => {
        if (this.conversationId === options.conversationId) {
          this.connect();
        }
      }).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  get mode(): 'remote' { return 'remote'; }

  getConversationId(): string | undefined { return this.conversationId; }

  getStatus(): ConversationStatus { return this.status; }

  setSettings(settings: OpenHandsSettings) {
    this.settings = settings;
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
  }

    async startNewConversation(): Promise<string | undefined> {
      try {
        if (this.ws) {
          this.ws.removeAllListeners();
          this.ws.close();
          this.ws = undefined;
        }
        this.seenEventIds.clear();
        this.setStatus('connecting');
        const base = this.serverUrl.replace(/\/$/, '');
        const s = this.settings;
        const llm: Record<string, unknown> = {};
        const toOptionalString = (value: unknown): string | undefined => {
          if (typeof value === 'string') return value.trim() || undefined;
          if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
            const text = String(value).trim();
            return text.length > 0 ? text : undefined;
          }
          return undefined;
        };
        const usageId = toOptionalString(s?.llm.usageId);
        const model = toOptionalString(s?.llm.model);
        const baseUrl = toOptionalString(s?.llm.baseUrl);
        const apiVersion = toOptionalString(s?.llm.apiVersion);
        if (usageId) llm.usage_id = usageId;
        if (model) llm.model = model;
        if (baseUrl) llm.base_url = baseUrl;
        if (apiVersion) llm.api_version = apiVersion;
        if (s?.llm.timeout !== undefined) llm.timeout = s.llm.timeout;
        if (s?.llm.temperature !== undefined) llm.temperature = s.llm.temperature;
        if (s?.llm.topP !== undefined) llm.top_p = s.llm.topP;
        if (s?.llm.topK !== undefined) llm.top_k = s.llm.topK;
        if (typeof s?.llm.maxInputTokens === 'number' && s.llm.maxInputTokens > 0) {
          llm.max_input_tokens = Math.trunc(s.llm.maxInputTokens);
        }
        if (typeof s?.llm.maxOutputTokens === 'number' && s.llm.maxOutputTokens > 0) {
          llm.max_output_tokens = Math.trunc(s.llm.maxOutputTokens);
        }
        if (s?.llm.reasoningEffort !== undefined) llm.reasoning_effort = s.llm.reasoningEffort;
        if (s?.secrets.llmApiKey) llm.api_key = s.secrets.llmApiKey;
        if (s?.secrets.awsAccessKeyId) llm.aws_access_key_id = s.secrets.awsAccessKeyId;
        if (s?.secrets.awsSecretAccessKey) llm.aws_secret_access_key = s.secrets.awsSecretAccessKey;

      const confirmation_policy: Record<string, unknown> = (() => {
        const p = s?.confirmation.policy || 'never';
        if (p === 'always') return { kind: 'AlwaysConfirm' };
        if (p === 'risky') {
          return {
            kind: 'ConfirmRisky',
            threshold: s?.confirmation.riskyThreshold || 'HIGH',
            confirm_unknown: s?.confirmation.confirmUnknown ?? true,
          };
        }
        return { kind: 'NeverConfirm' };
      })();

      const clampedMaxIterations = (() => {
        const raw = s?.conversation.maxIterations;
        const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 50;
        return Math.min(500, Math.max(1, n));
      })();
      const headers = this.getAuthHeaders();
        const req = {
          agent: {
            llm,
            tools: [
            { name: 'terminal' },
            { name: 'file_editor' },
            { name: 'task_tracker' }
          ],
          security_analyzer: s?.agent.enableSecurityAnalyzer ? { kind: 'LLMSecurityAnalyzer' } : undefined,
        },
        workspace: { kind: 'LocalWorkspace', working_dir: this.workspaceRoot },
        confirmation_policy,
        max_iterations: clampedMaxIterations,
      };
      const res = await fetch(`${base}/api/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req)
      });
        if (!res.ok) {
          const info = await res.text().catch(() => '');
          const status = res.status;
          let userMessage = `Failed to start conversation (HTTP ${status})`;
        if (status === 401 || status === 403) {
          userMessage += '. Authentication failed - check your Session API Key in settings.';
        } else if (status === 404) {
          userMessage += `. Server not found at ${this.serverUrl}. Check the server URL in settings.`;
        } else if (status >= 500) {
          userMessage += '. Server error - check agent-server logs.';
        }
        if (info) userMessage += ` Details: ${info}`;
        throw new Error(userMessage);
      }
      const json = await res.json() as { id?: string; conversation_id?: string; uuid?: string };
      this.conversationId = json.id || json.conversation_id || json.uuid;
      if (!this.conversationId) {
        throw new Error('Server response missing conversation ID. Check agent-server logs.');
      }
      this.emit('conversationStarted', this.conversationId);
      this.connect();
      return this.conversationId;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('fetch') || errorMsg.includes('ECONNREFUSED')) {
        this.emit('error', new Error(`Cannot connect to agent-server at ${this.serverUrl}. Is the server running? ${errorMsg}`));
      } else {
        this.emit('error', e instanceof Error ? e : new Error(String(e)));
      }
      return undefined;
    }
  }

  async restoreConversation(id: string) {
    this.conversationId = id;
    this.seenEventIds.clear();
    this.emit('conversationStarted', id);
    await this.replayHistory();
    this.connect();
  }

  async pause() {
    if (!this.conversationId) {
      this.emit('error', new Error('Cannot pause: no active conversation. Start a new conversation first.'));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();
      const res = await fetch(`${base}/api/conversations/${this.conversationId}/pause`, { method: 'POST', headers });
      if (!res.ok) {
        const info = await res.text().catch(() => '');
        const status = res.status;
        throw new Error(`Failed to pause conversation (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  async resume() {
    if (!this.conversationId) {
      this.emit('error', new Error('Cannot resume: no active conversation. Start a new conversation first.'));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();
      const res = await fetch(`${base}/api/conversations/${this.conversationId}/run`, { method: 'POST', headers });
      if (!res.ok) {
        const info = await res.text().catch(() => '');
        const status = res.status;
        throw new Error(`Failed to resume conversation (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  async approveAction(): Promise<void> {
    await this.respondToConfirmation(true);
  }

  async rejectAction(reason?: string): Promise<void> {
    await this.respondToConfirmation(false, reason);
  }

  private async respondToConfirmation(accept: boolean, reason?: string): Promise<void> {
    const action = accept ? 'approve' : 'reject';
    if (!this.conversationId) {
      this.emit('error', new Error(`Cannot ${action}: no active conversation.`));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();

      const payload: { accept: boolean; reason?: string } = { accept };
      if (!accept && reason !== undefined) payload.reason = reason;

      const res = await fetch(`${base}/api/conversations/${this.conversationId}/events/respond_to_confirmation`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const info = await res.text().catch(() => '');
        const status = res.status;
        throw new Error(`Failed to ${action} action (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      const id = await this.startNewConversation();
      if (!id) return;
    }
    const messagePayload: Message = { role: 'user', content: [{ type: 'text', text }] };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(messagePayload));
    } else {
      try {
        const base = this.serverUrl.replace(/\/$/, '');
        const headers = this.getAuthHeaders();
        const httpPayload = { ...messagePayload, run: true };
        const res = await fetch(`${base}/api/conversations/${this.conversationId}/events`, {
          method: 'POST', headers, body: JSON.stringify(httpPayload)
        });
        if (!res.ok) {
          const info = await res.text().catch(() => '');
          this.emit('error', new Error(`Failed to send message (HTTP ${res.status})${info ? `: ${info}` : ''}`));
        }
      } catch (e) { this.emit('error', e); }
    }
  }

  disconnect() {
    this.clearReconnect();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = undefined;
    }
    this.setStatus('offline');
  }

  reconnect() {
    if (this.conversationId) {
      this.connect();
    }
  }

  private setStatus(s: ConversationStatus) {
    this.status = s;
    this.emit('status', s);
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const sessionKey = this.settings?.secrets.sessionApiKey || '';
    if (sessionKey) headers['X-Session-API-Key'] = sessionKey;
    return headers;
  }

  private clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const base = Math.min(this.retryMaxMs, Math.floor(this.retryBaseMs * Math.pow(2, this.retryCount)));
    const jitter = Math.floor(base * 0.2 * Math.random());
    const delay = base + jitter;
    this.retryCount = Math.min(this.retryCount + 1, 10);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private connect() {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    const sessionKey = this.settings?.secrets.sessionApiKey || '';
    const params = new URLSearchParams();
    if (sessionKey) params.set('session_api_key', sessionKey);
    params.set('resend_all', 'true');
    const qs = params.toString();
    const wsUrl = `${base.replace(/^http/, 'ws')}/sockets/events/${this.conversationId}?${qs}`;
    this.setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => { this.retryCount = 0; this.setStatus('online'); });
    ws.on('close', () => { this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('error', (err: Error) => { this.emit('error', err); this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('message', (buf: Buffer) => {
      try {
        const str = buf.toString('utf8');
        const data = JSON.parse(str) as unknown;
        const normalized = this.normalizeEventPayload(data);
        if (isAgentEvent(normalized)) this.emitIfNewEvent(normalized);
        else this.emit('error', new Error(`Invalid event payload: ${JSON.stringify(normalized)}`));
      } catch (e) {
        this.emit('error', e);
      }
    });
  }

  private emitIfNewEvent(event: Event) {
    if (event?.id) {
      if (this.seenEventIds.has(event.id)) return;
      this.seenEventIds.add(event.id);
    }
    this.emit('event', event);
  }

  private async replayHistory(): Promise<void> {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    const headers = this.getAuthHeaders();
    let pageId: string | undefined;
    try {
      while (true) {
        const params = new URLSearchParams({ limit: String(RemoteConversation.historyPageLimit) });
        if (pageId) params.set('page_id', pageId);
        const res = await fetch(`${base}/api/conversations/${this.conversationId}/events/search?${params.toString()}`, { headers });
        if (!res.ok) {
          const info = await res.text().catch(() => '');
          this.emit('error', new Error(`Failed to fetch conversation history (HTTP ${res.status})${info ? `: ${info}` : ''}`));
          return;
        }
        const body = await res.json() as ConversationHistoryPage;
        const items = Array.isArray(body.items) ? body.items : [];
        for (const raw of items) {
          const normalized = this.normalizeEventPayload(raw);
          if (isAgentEvent(normalized)) {
            this.emitIfNewEvent(normalized);
          }
        }
        const next = body.next_page_id;
        if (!next || typeof next !== 'string') break;
        pageId = next;
      }
    } catch (e) {
      this.emit('error', e instanceof Error ? e : new Error(String(e)));
    }
  }

  private normalizeEventPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) return payload.map((item) => this.normalizeEventPayload(item));
    const obj = payload as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = this.normalizeEventPayload(value);
    }
    return normalized;
  }
}
