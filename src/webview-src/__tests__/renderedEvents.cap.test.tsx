import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';

vi.mock('../shared/constants', () => ({
  MAX_RENDERED_EVENTS: 10,
}));

describe('App - Rendered events cap', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error -- VS Code API is injected by host environment during runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('caps rendered events list and keeps newest events', async () => {
    const { App } = await import('../components/App');

    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'webviewReady' }));
    });

    mockApi.postMessage.mockClear();

    act(() => {
      for (let i = 0; i < 15; i++) {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'MessageEvent',
              source: 'user',
              e2e_marker: `m${i}`,
              llm_message: { role: 'user', content: [{ type: 'text', text: `m${i}` }] },
            },
          },
        }));
      }
    });

    const requestId = 'rendered-events-cap';
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'queryRenderedEvents', requestId } }));
    });

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'renderedEventsResponse',
          requestId,
          count: 10,
        })
      );
    });

    const responses = mockApi.postMessage.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => (
        typeof payload === 'object'
        && payload !== null
        && (payload as { type?: unknown }).type === 'renderedEventsResponse'
        && (payload as { requestId?: unknown }).requestId === requestId
      ));

    expect(responses).toHaveLength(1);

    const response = responses[0] as {
      count: number;
      events?: Array<{ marker?: string }>;
    };

    expect(response.count).toBe(10);
    expect(response.events?.map((event) => event.marker)).toEqual([
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
      'm11',
      'm12',
      'm13',
      'm14',
    ]);
  });
});
