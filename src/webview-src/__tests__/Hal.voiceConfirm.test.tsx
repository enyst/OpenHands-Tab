import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type { ActionEvent, ConversationStateUpdateEvent } from '@openhands/agent-sdk-ts';
import { postToWindow } from './testUtils';

describe('HAL voice_confirm', () => {
  const mockApi = { postMessage: vi.fn() } as any;

  const mkHighRiskAction = (toolCallId: string): ActionEvent => ({
    kind: 'ActionEvent',
    source: 'agent',
    thought: [{ type: 'text', text: 'High-risk action' }],
    action: { command: 'rm -rf /tmp/test' },
    tool_name: 'terminal',
    tool_call_id: toolCallId,
    tool_call: {
      id: toolCallId,
      type: 'function',
      function: { name: 'terminal', arguments: '{"command":"rm -rf /tmp/test"}' },
    },
    llm_response_id: 'resp_hal_high',
    security_risk: 'HIGH',
  } as any);

  const setWaitingForConfirmation = () => {
    const state: ConversationStateUpdateEvent = { kind: 'ConversationStateUpdateEvent', agent_status: 'WAITING_FOR_CONFIRMATION' } as any;
    postToWindow({ type: 'event', event: state });
  };

  const renderAppAndWaitReady = async () => {
    const res = render(<App />);
    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });
    return res;
  };

  const advanceBundledDialogueToAwaitingUser = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
    }
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/Please choose an action\./)).toBeInTheDocument();
  };

  beforeEach(() => {
    vi.useRealTimers();
    // @ts-expect-error -- VS Code API is injected by host environment during runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
    try {
      // @ts-expect-error -- not implemented in jsdom by default
      delete (globalThis as any).MediaRecorder;
      // @ts-expect-error -- not implemented in jsdom by default
      delete (window as any).MediaRecorder;
    } catch {}
    try {
      Object.defineProperty(window.navigator, 'mediaDevices', { value: undefined, configurable: true });
    } catch {}
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('allows exiting while teleport is in progress and sends cancel', async () => {
    await renderAppAndWaitReady();

    vi.useFakeTimers();
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'bundled', userName: 'Engel', volume: 1 } });
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkHighRiskAction('call-hal-teleport-exit-1') });

    await advanceBundledDialogueToAwaitingUser();

    const teleportBtn = screen.getByRole('button', { name: /teleport to remote/i });
    fireEvent.click(teleportBtn);

    const exitBtn = screen.getByRole('button', { name: /exit/i });
    expect(exitBtn).not.toBeDisabled();

    fireEvent.click(exitBtn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'cancelTeleportAction' });
  });

  it('shows a friendly teleport failure message with server url', async () => {
    await renderAppAndWaitReady();

    vi.useFakeTimers();
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'bundled', userName: 'Engel', volume: 1 } });
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkHighRiskAction('call-hal-teleport-fail-1') });

    await advanceBundledDialogueToAwaitingUser();
    fireEvent.click(screen.getByRole('button', { name: /teleport to remote/i }));

    postToWindow({ type: 'halTeleportFailed', error: 'TypeError: fetch failed', serverUrl: 'http://localhost:3000' });

    expect(screen.getByText(/Remote server is not available at this time\./)).toBeInTheDocument();
    expect(screen.getAllByText(/http:\/\/localhost:3000/).length).toBeGreaterThan(0);
  });

  it('falls back to buttons when microphone is unavailable', async () => {
    await renderAppAndWaitReady();

    vi.useFakeTimers();
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'bundled', userName: 'Engel', volume: 1 } });
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkHighRiskAction('call-hal-voice-1') });

    await advanceBundledDialogueToAwaitingUser();
    vi.useRealTimers();

    // Switch to voice_confirm at decision time.
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'voice_confirm', userName: 'Engel', volume: 1 } });

    const recordButton = await screen.findByRole('button', { name: /record decision/i });
    fireEvent.click(recordButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve locally/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /record decision/i })).not.toBeInTheDocument();
  });

  it('records audio, sends it to host, and applies approve decision', async () => {
    await renderAppAndWaitReady();

    vi.useFakeTimers();
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'bundled', userName: 'Engel', volume: 1 } });
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkHighRiskAction('call-hal-voice-2') });
    await advanceBundledDialogueToAwaitingUser();
    vi.useRealTimers();

    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'voice_confirm', userName: 'Engel', volume: 1 } });

    const stream = { getTracks: () => [{ stop: vi.fn() }] } as any;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    const getUserMedia = (window.navigator as any).mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;

    let didCreateRecorder = false;
    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      public state: 'inactive' | 'recording' = 'inactive';
      public mimeType = 'audio/webm';
      public ondataavailable: ((e: any) => void) | null = null;
      public onstop: (() => void) | null = null;
      constructor(_stream: any, _opts?: any) {
        didCreateRecorder = true;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['hello'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }

    // @ts-expect-error -- MediaRecorder is not implemented in jsdom
    (globalThis as any).MediaRecorder = MockMediaRecorder;
    // @ts-expect-error -- MediaRecorder is not implemented in jsdom
    (window as any).MediaRecorder = MockMediaRecorder;

    fireEvent.click(await screen.findByRole('button', { name: /record decision/i }));
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(didCreateRecorder).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    const request = await waitFor(() => {
      const req = mockApi.postMessage.mock.calls
        .map((call: any[]) => call[0])
        .find((msg: any) => msg?.type === 'halVoiceConfirmRequest');
      if (!req) {
        const types = mockApi.postMessage.mock.calls
          .map((call: any[]) => call?.[0]?.type)
          .filter(Boolean);
        throw new Error(`Missing halVoiceConfirmRequest. Saw: ${types.join(', ')}`);
      }
      return req;
    });

    postToWindow({ type: 'halVoiceConfirmResponse', requestId: request.requestId, ok: true, decision: 'approve_local' });
    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'approveAction' });
    });
  });

  it('falls back to buttons when Gemini classification fails', async () => {
    await renderAppAndWaitReady();

    vi.useFakeTimers();
    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'bundled', userName: 'Engel', volume: 1 } });
    setWaitingForConfirmation();
    postToWindow({ type: 'event', event: mkHighRiskAction('call-hal-voice-3') });
    await advanceBundledDialogueToAwaitingUser();
    vi.useRealTimers();

    postToWindow({ type: 'halSettings', hal: { enabled: true, mode: 'voice_confirm', userName: 'Engel', volume: 1 } });

    const stream = { getTracks: () => [{ stop: vi.fn() }] } as any;
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true,
    });
    const getUserMedia = (window.navigator as any).mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;

    let didCreateRecorder = false;
    class MockMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      public state: 'inactive' | 'recording' = 'inactive';
      public mimeType = 'audio/webm';
      public ondataavailable: ((e: any) => void) | null = null;
      public onstop: (() => void) | null = null;
      constructor(_stream: any, _opts?: any) {
        didCreateRecorder = true;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['hello'], { type: this.mimeType }) });
        this.onstop?.();
      }
    }

    // @ts-expect-error -- MediaRecorder is not implemented in jsdom
    (globalThis as any).MediaRecorder = MockMediaRecorder;
    // @ts-expect-error -- MediaRecorder is not implemented in jsdom
    (window as any).MediaRecorder = MockMediaRecorder;

    fireEvent.click(await screen.findByRole('button', { name: /record decision/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(didCreateRecorder).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: /stop/i }));
    const request = await waitFor(() => {
      const req = mockApi.postMessage.mock.calls
        .map((call: any[]) => call[0])
        .find((msg: any) => msg?.type === 'halVoiceConfirmRequest');
      if (!req) {
        const types = mockApi.postMessage.mock.calls
          .map((call: any[]) => call?.[0]?.type)
          .filter(Boolean);
        throw new Error(`Missing halVoiceConfirmRequest. Saw: ${types.join(', ')}`);
      }
      return req;
    });

    postToWindow({ type: 'halVoiceConfirmResponse', requestId: request.requestId, ok: false, error: 'Gemini failed' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve locally/i })).toBeInTheDocument();
    });
    expect(mockApi.postMessage).not.toHaveBeenCalledWith({ type: 'command', command: 'approveAction' });
  });
});
