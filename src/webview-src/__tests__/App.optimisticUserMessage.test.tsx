import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { App } from '../components/App';
import { postToWindow } from './testUtils';
import type { ConversationStateUpdateEvent, MessageEvent } from '@openhands/agent-sdk-ts';

describe('App - optimistic user MessageEvent rendering', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error -- VS Code API is injected by host environment during runtime
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an optimistic user message immediately and keeps queued badge until the real event arrives', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });

    postToWindow({ type: 'status', status: 'online', mode: 'remote' });

    const running: ConversationStateUpdateEvent = {
      kind: 'ConversationStateUpdateEvent',
      agent_status: 'RUNNING',
    } as ConversationStateUpdateEvent;
    postToWindow({ type: 'event', event: running });

    const input = screen.getByPlaceholderText('Ask OpenHands anything...') as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(input, 'hello{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', text: 'hello' }));

    const optimistic: MessageEvent = {
      kind: 'MessageEvent',
      id: 'optimistic:test',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as MessageEvent;
    postToWindow({ type: 'event', event: optimistic });

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByTestId('queued-messages-badge')).toHaveTextContent('1');

    const persisted: MessageEvent = {
      ...optimistic,
      id: 'server:test',
    } as MessageEvent;
    postToWindow({ type: 'event', event: persisted });

    expect(screen.getAllByText('hello')).toHaveLength(1);
    expect(screen.queryByTestId('queued-messages-badge')).toBeNull();
  });

  it('skips an optimistic user message if the persisted event already arrived', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });

    postToWindow({ type: 'status', status: 'online', mode: 'remote' });

    const persisted: MessageEvent = {
      kind: 'MessageEvent',
      id: 'server:test',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as MessageEvent;
    postToWindow({ type: 'event', event: persisted });

    const optimistic: MessageEvent = {
      kind: 'MessageEvent',
      id: 'optimistic:test',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as MessageEvent;
    postToWindow({ type: 'event', event: optimistic });

    expect(screen.getAllByText('hello')).toHaveLength(1);
  });

  it('deduplicates an optimistic user message when the persisted event adds <environment information> extended content', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });

    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const running: ConversationStateUpdateEvent = {
      kind: 'ConversationStateUpdateEvent',
      agent_status: 'RUNNING',
    } as ConversationStateUpdateEvent;
    postToWindow({ type: 'event', event: running });

    const input = screen.getByPlaceholderText('Ask OpenHands anything...') as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(input, 'hello{enter}');

    const optimistic: MessageEvent = {
      kind: 'MessageEvent',
      id: 'optimistic:test',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as MessageEvent;
    postToWindow({ type: 'event', event: optimistic });

    expect(screen.getAllByText('hello')).toHaveLength(1);

    const persisted: MessageEvent = {
      ...optimistic,
      id: 'server:test',
      extended_content: [
        {
          type: 'text',
          text: '<environment information>\nActive editor: /tmp/a.ts\n</environment information>',
        },
      ],
    } as MessageEvent;
    postToWindow({ type: 'event', event: persisted });

    expect(screen.getAllByText('hello')).toHaveLength(1);
  });

  it('deduplicates an optimistic user message when the persisted event adds <EXTRA_INFO> extended content', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'webviewReady' });
    });

    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const optimistic: MessageEvent = {
      kind: 'MessageEvent',
      id: 'optimistic:test',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as MessageEvent;
    postToWindow({ type: 'event', event: optimistic });

    const persisted: MessageEvent = {
      ...optimistic,
      id: 'server:test',
      extended_content: [
        {
          type: 'text',
          text: '<EXTRA_INFO>\nInjected skill content\n</EXTRA_INFO>',
        },
      ],
    } as MessageEvent;
    postToWindow({ type: 'event', event: persisted });

    expect(screen.getAllByText('hello')).toHaveLength(1);
  });
});
