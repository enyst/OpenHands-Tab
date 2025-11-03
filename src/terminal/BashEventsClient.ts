import WebSocket from 'ws';
import type { BashEvent } from '../types/agent-sdk';
import { isBashEvent } from '../types/agent-sdk';

export type BashEventsCallbacks = {
  onEvent: (event: BashEvent) => void;
  onError: (err: any) => void;
  onStatus: (status: 'online' | 'offline' | 'connecting') => void;
};

/**
 * BashEventsClient subscribes to the agent-server's /sockets/bash-events WebSocket
 * to receive live bash command execution events (BashCommand, BashOutput, BashExit).
 *
 * Features:
 * - Independent lifecycle from conversation events
 * - Automatic reconnection with exponential backoff
 * - Type-safe bash event handling
 */
export class BashEventsClient {
  private serverUrl: string;
  private sessionApiKey?: string;
  private ws?: WebSocket;
  private status: 'online' | 'offline' | 'connecting' = 'offline';
  private callbacks: BashEventsCallbacks;
  private reconnectTimer?: NodeJS.Timeout;
  private retryCount = 0;
  private readonly retryBaseMs = 1000;
  private readonly retryMaxMs = 15000;

  constructor(serverUrl: string, callbacks: BashEventsCallbacks, sessionApiKey?: string) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
    this.sessionApiKey = sessionApiKey;
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
  }

  setSessionApiKey(key?: string) {
    this.sessionApiKey = key;
  }

  getStatus() {
    return this.status;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.status === 'connecting') {
      return;
    }

    this.setStatus('connecting');
    this.clearReconnectTimer();

    try {
      const base = this.serverUrl.replace(/^http/, 'ws').replace(/\/$/, '');
      let url = `${base}/sockets/bash-events`;
      if (this.sessionApiKey) {
        url += `?session_api_key=${encodeURIComponent(this.sessionApiKey)}`;
      }

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.setStatus('online');
        this.retryCount = 0;
      });

      this.ws.on('message', (data: any) => {
        try {
          const event = JSON.parse(data.toString());
          if (isBashEvent(event)) {
            this.callbacks.onEvent(event);
          } else {
            console.warn('[BashEventsClient] Unknown event type:', event?.type);
          }
        } catch (e) {
          console.error('[BashEventsClient] Failed to parse message:', e);
        }
      });

      this.ws.on('error', (err) => {
        this.callbacks.onError(err);
      });

      this.ws.on('close', () => {
        this.setStatus('offline');
        this.scheduleReconnect();
      });
    } catch (e) {
      this.callbacks.onError(e);
      this.setStatus('offline');
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = undefined;
    }
    this.setStatus('offline');
  }

  reconnect() {
    this.disconnect();
    this.retryCount = 0;
    this.connect();
  }

  /**
   * Inject a bash event directly (for testing).
   * Validates the event and triggers the onEvent callback.
   */
  injectEvent(event: BashEvent) {
    if (isBashEvent(event)) {
      this.callbacks.onEvent(event);
    } else {
      throw new Error('Invalid bash event for injection');
    }
  }

  private setStatus(status: 'online' | 'offline' | 'connecting') {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onStatus(status);
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const base = Math.min(this.retryMaxMs, Math.floor(this.retryBaseMs * Math.pow(2, this.retryCount)));
    const jitter = Math.floor(base * 0.2 * Math.random());
    const delay = base + jitter;
    this.retryCount = Math.min(this.retryCount + 1, 10);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
