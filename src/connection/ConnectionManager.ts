import WebSocket from 'ws';
import type { Event, Message } from '@openhands/agent-sdk-ts';
import { isEvent as isAgentEvent } from '@openhands/agent-sdk-ts';
import type { OpenHandsSettings } from '../settings/SettingsManager';

export type ConnectionEvents = {
  onStatus: (status: 'online' | 'offline' | 'connecting') => void;
  onEvent: (event: Event) => void;
  onError: (err: unknown) => void;
  onConversationId?: (id: string | undefined) => void;
};

/**
 * ConnectionManager handles all communication with the OpenHands agent-server.
 *
 * Features:
 * - WebSocket connection for real-time event streaming
 * - HTTP fallback for message sending when WebSocket is unavailable
 * - Automatic reconnection with exponential backoff (1s base, max 15s)
 * - Conversation lifecycle management (create, pause, resume)
 * - Settings-driven configuration (LLM, security, confirmation policies)
 */
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
      if (this.ws) {
        try {
          this.ws.removeAllListeners();
          this.ws.close();
} catch (e) { console.warn('[ConnectionManager] Failed to close previous WebSocket:', e); }
        this.ws = undefined;
      }
      this.setStatus('connecting');
      const base = this.serverUrl.replace(/\/$/, '');
      const s = this.settings;
      const llm: Record<string, unknown> = {};
      const usageId = s?.llm.usageId != null ? String(s.llm.usageId).trim() : undefined;
      const model = s?.llm.model != null ? String(s.llm.model).trim() : undefined;
      const baseUrl = s?.llm.baseUrl != null ? String(s.llm.baseUrl).trim() : undefined;
      const apiVersion = s?.llm.apiVersion != null ? String(s.llm.apiVersion).trim() : undefined;
      if (usageId) llm.usage_id = usageId;
      if (model) llm.model = model;
      if (baseUrl) llm.base_url = baseUrl;
      if (apiVersion) llm.api_version = apiVersion;
      if (s?.llm.timeout != null) llm.timeout = s.llm.timeout;
      if (s?.llm.temperature != null) llm.temperature = s.llm.temperature;
      if (s?.llm.topP != null) llm.top_p = s.llm.topP;
      if (s?.llm.topK != null) llm.top_k = s.llm.topK;
      if (s?.llm.maxInputTokens != null && s.llm.maxInputTokens > 0) {
        llm.max_input_tokens = s.llm.maxInputTokens;
      }
      if (s?.llm.maxOutputTokens != null && s.llm.maxOutputTokens > 0) {
        llm.max_output_tokens = s.llm.maxOutputTokens;
      }
      if (s?.llm.nativeToolCalling != null) llm.native_tool_calling = s.llm.nativeToolCalling;
      if (s?.llm.reasoningEffort != null) llm.reasoning_effort = s.llm.reasoningEffort;
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

      // Determine workspace root: prefer VS Code workspace root when extension runs in host;
      // fall back to process.cwd() for tests and non-vscode environments.
      const root = (globalThis as { vscodeWorkspaceRoot?: string }).vscodeWorkspaceRoot || process.cwd();
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
        workspace: { kind: 'LocalWorkspace', working_dir: root },
        confirmation_policy,
        max_iterations: clampedMaxIterations,
      };
      const res = await fetch(`${base}/api/conversations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req)
      });
      if (!res.ok) {
        let info = '';
        try { info = await res.text(); } catch {}
        const status = res.status;
        // Provide user-friendly error messages based on status code
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
      this.events.onConversationId?.(this.conversationId);
      this.connect();
      return this.conversationId;
    } catch (e) {
      // Add context to generic network errors
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('fetch') || errorMsg.includes('ECONNREFUSED')) {
        this.events.onError(new Error(`Cannot connect to agent-server at ${this.serverUrl}. Is the server running? ${errorMsg}`));
      } else {
        this.events.onError(e instanceof Error ? e : new Error(String(e)));
      }
      return undefined;
    }
  }

  restoreConversation(id: string) {
    this.conversationId = id;
    this.connect();
  }

  async pause() {
    if (!this.conversationId) {
      this.events.onError(new Error('Cannot pause: no active conversation. Start a new conversation first.'));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();
      const res = await fetch(`${base}/api/conversations/${this.conversationId}/pause`, { method: 'POST', headers });
      if (!res.ok) {
        let info = '';
        try { info = await res.text(); } catch {}
        const status = res.status;
        throw new Error(`Failed to pause conversation (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.events.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async resume() {
    if (!this.conversationId) {
      this.events.onError(new Error('Cannot resume: no active conversation. Start a new conversation first.'));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();
      const res = await fetch(`${base}/api/conversations/${this.conversationId}/run`, { method: 'POST', headers });
      if (!res.ok) {
        let info = '';
        try { info = await res.text(); } catch {}
        const status = res.status;
        throw new Error(`Failed to resume conversation (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.events.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Approves a pending action during confirmation mode.
   *
   * When confirmation policy requires user approval (AlwaysConfirm or ConfirmRisky),
   * this method sends acceptance to the agent-server to proceed with execution.
   *
   * Endpoint: POST /api/conversations/{id}/events/respond_to_confirmation
   * Payload: { accept: true }
   */
  async approveAction(): Promise<void> {
    await this.respondToConfirmation(true);
  }

  /**
   * Rejects a pending action during confirmation mode.
   *
   * When confirmation policy requires user approval, this method sends rejection
   * to the agent-server to skip the action and continue with alternative approaches.
   *
   * Endpoint: POST /api/conversations/{id}/events/respond_to_confirmation
   * Payload: { accept: false, reason?: string }
   */
  async rejectAction(reason?: string): Promise<void> {
    await this.respondToConfirmation(false, reason);
  }

  /**
   * Helper method for sending confirmation responses to the agent-server.
   *
   * @param accept - Whether to approve (true) or reject (false) the action
   * @param reason - Optional rejection reason (only used when accept is false)
   * @private
   */
  private async respondToConfirmation(accept: boolean, reason?: string): Promise<void> {
    const action = accept ? 'approve' : 'reject';
    if (!this.conversationId) {
      this.events.onError(new Error(`Cannot ${action}: no active conversation.`));
      return;
    }
    const base = this.serverUrl.replace(/\/$/, '');
    try {
      const headers = this.getAuthHeaders();

      const payload: { accept: boolean; reason?: string } = { accept };
      // Include reason if explicitly provided (even if empty string)
      if (!accept && reason !== undefined) payload.reason = reason;

      const res = await fetch(`${base}/api/conversations/${this.conversationId}/events/respond_to_confirmation`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let info = '';
        try { info = await res.text(); } catch {}
        const status = res.status;
        throw new Error(`Failed to ${action} action (HTTP ${status})${info ? `: ${info}` : ''}`);
      }
    } catch (e) {
      this.events.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Sends a user message to the agent.
   *
   * Message delivery strategy:
   * 1. If no conversation exists, creates one first
   * 2. If WebSocket is open: sends message over WS for immediate delivery
   * 3. If WebSocket is closed/connecting: falls back to HTTP POST to /events/
   *
   * This fallback ensures messages are queued even when the connection is unstable.
   */
  async sendUserMessage(text: string) {
    if (!this.conversationId) {
      const id = await this.startNewConversation();
      if (!id) return; // bail if conversation could not be started
    }
    // agent-sdk expects content to be an array of TextContent objects
    const messagePayload: Message = { role: 'user', content: [{ type: 'text', text }] };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(messagePayload));
    } else {
      // Fallback to HTTP when WebSocket unavailable
      try {
        const base = this.serverUrl.replace(/\/$/, '');
        const headers = this.getAuthHeaders();
        const httpPayload = { ...messagePayload, run: true };
        const res = await fetch(`${base}/api/conversations/${this.conversationId}/events`, {
          method: 'POST', headers, body: JSON.stringify(httpPayload)
        });
        if (!res.ok) {
          const info = await res.text().catch(() => '');
          this.events.onError(new Error(`Failed to send message (HTTP ${res.status})${info ? `: ${info}` : ''}`));
        }
      } catch (e) { this.events.onError(e); }
    }
  }

  disconnect() {
    this.clearReconnect();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
      this.ws = undefined;
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

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const sessionKey = this.settings?.secrets.sessionApiKey || '';
    if (sessionKey) headers['X-Session-API-Key'] = sessionKey;
    return headers;
  }

  private clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
  }

  /**
   * Schedules WebSocket reconnection with exponential backoff and jitter.
   *
   * Retry strategy:
   * - Base delay: 1s, doubles each attempt (2s, 4s, 8s, ...)
   * - Max delay: 15s (prevents excessive wait times)
   * - Jitter: +0-20% randomization to avoid thundering herd
   * - Max retry count: 10 (prevents overflow)
   *
   * Called automatically on WebSocket close/error events.
   */
  private scheduleReconnect() {
    this.clearReconnect();
    const base = Math.min(this.retryMaxMs, Math.floor(this.retryBaseMs * Math.pow(2, this.retryCount)));
    const jitter = Math.floor(base * 0.2 * Math.random());
    const delay = base + jitter;
    this.retryCount = Math.min(this.retryCount + 1, 10);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Establishes WebSocket connection to agent-server.
   *
   * Connection lifecycle:
   * - URL: ws(s)://{serverUrl}/sockets/events/{conversation_id}?session_api_key=...
   * - On open: resets retry count and sets status to 'online'
   * - On close/error: sets status to 'offline' and schedules reconnection
   * - On message: validates with type guards and emits event to listeners
   *
   * All incoming messages must pass isAgentEvent() validation to prevent
   * malformed data from reaching the UI.
   */
  private connect() {
    if (!this.conversationId) return;
    const base = this.serverUrl.replace(/\/$/, '');
    const sessionKey = this.settings?.secrets.sessionApiKey || '';
    // agent-sdk WS path: /sockets/events/{conversation_id} with optional session_api_key
    const qs = sessionKey ? `?session_api_key=${encodeURIComponent(sessionKey)}` : '';
    const wsUrl = base.replace(/^http/, 'ws') + `/sockets/events/${this.conversationId}${qs}`;
    this.setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => { this.retryCount = 0; this.setStatus('online'); });
    ws.on('close', () => { this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('error', (err) => { this.events.onError(err); this.setStatus('offline'); this.scheduleReconnect(); });
    ws.on('message', (buf: Buffer) => {
      try {
        const str = buf.toString('utf8');
        const data = JSON.parse(str) as unknown;
        const normalized = this.normalizeEventPayload(data);
        // Validate event structure before propagating to UI
        if (isAgentEvent(normalized)) this.events.onEvent(normalized);
        else this.events.onError(new Error(`Invalid event payload: ${JSON.stringify(normalized)}`));
      } catch (e) {
        this.events.onError(e);
      }
    });
  }

  private normalizeEventPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') return payload;
    if (Array.isArray(payload)) return payload.map((item) => this.normalizeEventPayload(item));
    const obj = payload as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      normalized[key] = this.normalizeEventPayload(value);
    }
    // Backward-compat: accept inbound 'type' or 'kind' ONLY for top-level event-like objects
    if (typeof obj.type === 'string' && typeof normalized.kind !== 'string') {
      const t = obj.type;
      const eventTypeLike = ['Condensation', 'UserRejectObservation'];
      if (/Event$/.test(t) || eventTypeLike.includes(t)) {
        normalized.kind = t;
      }
    }
    return normalized;
  }
}
