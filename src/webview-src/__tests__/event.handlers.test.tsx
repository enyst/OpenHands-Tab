import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

function postToWindow(payload: unknown) {
  window.postMessage(payload, '*');
}

describe('App event handling helpers', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error VS Code API injected at runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
    // @ts-expect-error reset cached api
    delete window.__OH_VSCODE_API__;
  });

  it('clears streaming content when an agent action arrives after streaming', async () => {
    render(<App />);

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ConversationStateUpdateEvent',
          key: 'llm_stream',
          value: 'Streaming chunk alpha',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Streaming chunk alpha')).toBeInTheDocument();
    });

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ActionEvent',
          source: 'agent',
          action: { tool: 'terminal', args: { command: 'echo test' } },
          thought: [{ type: 'text', text: 'Running command' }],
          tool_name: 'terminal',
          tool_call_id: 'call-stream-reset',
          tool_call: { id: 'call-stream-reset', type: 'function', function: { name: 'terminal', arguments: '{}' } },
          llm_response_id: 'response-1',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('streaming...')).not.toBeInTheDocument();
      expect(screen.queryByText('Streaming chunk alpha')).not.toBeInTheDocument();
    });
  });
});
