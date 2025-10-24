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
      const llm: any = {
        usage_id: s?.llm.usageId || 'default-llm',
        model: s?.llm.model || 'claude-sonnet-4-20250514',
      };
      if (s?.llm.baseUrl != null) llm.base_url = s.llm.baseUrl;
      if (s?.llm.apiVersion != null) llm.api_version = s.llm.apiVersion;
      if (s?.llm.timeout != null) llm.timeout = s.llm.timeout;
      if (s?.llm.temperature != null) llm.temperature = s.llm.temperature;
      if (s?.llm.topP != null) llm.top_p = s.llm.topP;
      if (s?.llm.topK != null) llm.top_k = s.llm.topK;
      if (s?.llm.maxInputTokens != null) llm.max_input_tokens = s.llm.maxInputTokens;
      if (s?.llm.maxOutputTokens != null) llm.max_output_tokens = s.llm.maxOutputTokens;
      if (s?.llm.nativeToolCalling != null) llm.native_tool_calling = s.llm.nativeToolCalling;
      if (s?.llm.reasoningEffort != null) llm.reasoning_effort = s.llm.reasoningEffort;
      if (s?.secrets.llmApiKey) llm.api_key = s.secrets.llmApiKey;
      if (s?.secrets.awsAccessKeyId) llm.aws_access_key_id = s.secrets.awsAccessKeyId;
      if (s?.secrets.awsSecretAccessKey) llm.aws_secret_access_key = s.secrets.awsSecretAccessKey;

      const confirmation_policy: any = (() => {
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

      // Determine workspace root: prefer VS Code workspace root when extension runs in host;
      // fall back to process.cwd() for tests and non-vscode environments.
      const root = (globalThis as any).vscodeWorkspaceRoot || process.cwd();
      const req = {
        agent: {
          llm,
          tools: [
            { name: 'BashTool', params: { working_dir: root } },
            { name: 'FileEditorTool', params: { workspace_root: root } },
            { name: 'TaskTrackerTool', params: { save_dir: root } }
          ],
          security_analyzer: s?.agent.enableSecurityAnalyzer ? { kind: 'LLMSecurityAnalyzer' } : undefined,
        },
        workspace: { kind: 'LocalWorkspace', working_dir: root },
        confirmation_policy,
        max_iterations: s?.conversation.maxIterations ?? 50,
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
