import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

describe('App render', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error mock VS Code API for tests
    window.acquireVsCodeApi = () => mockApi;
    // @ts-expect-error reset cached api instance
    delete window.__OH_VSCODE_API__;
    mockApi.postMessage.mockClear();
  });

  it('renders header, input, and toolbar controls', () => {
    render(<App />);
    expect(screen.getByText('OpenHands')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask OpenHands anything...')).toBeInTheDocument();
    expect(screen.getByLabelText('New')).toBeInTheDocument();
    expect(screen.getByLabelText('Add context')).toBeInTheDocument();
  });

  it('displays streaming content incrementally', async () => {
    render(<App />);

    // Simulate a user message first
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'MessageEvent',
              source: 'user',
              llm_message: {
                role: 'user',
                content: [{ type: 'text', text: 'Test user message xyz123' }],
              },
            },
          },
        })
      );
    });

    await waitFor(() => {
      // Use getAllByText since there may be multiple due to test isolation
      const elements = screen.getAllByText('Test user message xyz123');
      expect(elements.length).toBeGreaterThan(0);
    });

    // Simulate streaming start
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              source: 'agent',
              key: 'llm_stream',
              value: 'Streaming chunk alpha',
            },
          },
        })
      );
    });

    await waitFor(() => {
      const streamElements = screen.queryAllByText('Streaming chunk alpha');
      expect(streamElements.length).toBeGreaterThan(0);
      expect(screen.queryAllByText('streaming...').length).toBeGreaterThan(0);
    });

    // Simulate more streaming content
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              source: 'agent',
              key: 'llm_stream',
              value: 'Streaming chunk alpha beta',
            },
          },
        })
      );
    });

    await waitFor(() => {
      const streamElements = screen.queryAllByText('Streaming chunk alpha beta');
      expect(streamElements.length).toBeGreaterThan(0);
    });

    // Simulate final message (ends streaming)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'MessageEvent',
              source: 'agent',
              llm_message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Final response content gamma' }],
              },
            },
          },
        })
      );
    });

    await waitFor(() => {
      const finalElements = screen.queryAllByText('Final response content gamma');
      expect(finalElements.length).toBeGreaterThan(0);
      // Streaming indicator should be gone after final message
      expect(screen.queryByText('streaming...')).not.toBeInTheDocument();
    });
  });
});
