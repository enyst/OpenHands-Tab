import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
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

  afterEach(() => {
    cleanup();
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

  it('does not render conversation state updates but responds to queries with count', async () => {
    render(<App />);

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ConversationStateUpdateEvent',
          agent_status: 'WAITING_FOR_CONFIRMATION',
        },
      });
    });

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ConversationStateUpdateEvent',
          key: 'llm_stream',
          value: 'Streaming chunk beta',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Streaming chunk beta')).toBeInTheDocument();
    });

    await act(async () => {
      postToWindow({
        type: 'queryRenderedEvents',
      });
    });

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'renderedEventsResponse', count: 0 })
      );
    });
  });

  it('clears streaming content when an assistant message arrives', async () => {
    render(<App />);

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ConversationStateUpdateEvent',
          key: 'llm_stream',
          value: 'Streaming chunk gamma',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Streaming chunk gamma')).toBeInTheDocument();
    });

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'MessageEvent',
          llm_response_id: 'resp-1',
          llm_message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'final output' }],
          },
          source: 'agent',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Streaming chunk gamma')).not.toBeInTheDocument();
    });
  });

  it('shows and hides confirmation prompt as pending actions change', async () => {
    render(<App />);

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ConversationStateUpdateEvent',
          agent_status: 'WAITING_FOR_CONFIRMATION',
        },
      });
    });

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ActionEvent',
          source: 'agent',
          action: { tool: 'terminal', args: { command: 'pwd' } },
          thought: [{ type: 'text', text: 'Checking path' }],
          tool_name: 'terminal',
          tool_call_id: 'call-pending',
          tool_call: { id: 'call-pending', type: 'function', function: { name: 'terminal', arguments: '{}' } },
          llm_response_id: 'response-2',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Confirmation Required/)).toBeInTheDocument();
    });

    await act(async () => {
      postToWindow({
        type: 'event',
        event: {
          kind: 'ObservationEvent',
          source: 'environment',
          observation: { content: 'done' },
          tool_name: 'terminal',
          tool_call_id: 'call-pending',
          action_id: 'a2',
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Confirmation Required/)).not.toBeInTheDocument();
    });
  });
});
