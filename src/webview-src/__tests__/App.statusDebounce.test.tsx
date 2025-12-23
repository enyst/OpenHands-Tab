import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

function dispatchToWindow(payload: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
  });
}

describe('App - status banner debounce', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error -- VS Code API is injected by host environment during runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanup();
  });

  it('does not debounce across App mounts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    const first = render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'webviewReady' }));
    });

    await waitFor(() => {
      dispatchToWindow({ type: 'halTeleportUnavailable', error: 'No server available' });
      expect(screen.getByText('No server available')).toBeInTheDocument();
    });

    first.unmount();
    mockApi.postMessage.mockClear();

    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'webviewReady' }));
    });

    await waitFor(() => {
      dispatchToWindow({ type: 'halTeleportUnavailable', error: 'No server available' });
      expect(screen.getByText('No server available')).toBeInTheDocument();
    });
  });
});
