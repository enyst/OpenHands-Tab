import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type { MessageEvent as AgentMessageEvent } from '@openhands/agent-sdk-ts';
import { postToWindow } from './testUtils';

describe('Pasted images', () => {
  const mockApi = { postMessage: vi.fn() } as any;

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

  it('adds pasted images as previews and includes them in sent message', async () => {
    render(<App />);
    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const textarea = screen.getByRole('textbox');
    await waitFor(() => expect(textarea).not.toBeDisabled());
    fireEvent.change(textarea, { target: { value: 'hello' } });

    const file = new File([Uint8Array.from([1, 2, 3])], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    } as any);

    await waitFor(() => {
      expect(screen.getByAltText('pasted.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    const sent = await waitFor(() => {
      const msg = mockApi.postMessage.mock.calls
        .map((call: any[]) => call[0])
        .find((m: any) => m?.type === 'send');
      if (!msg) throw new Error('Missing send message');
      return msg;
    });

    expect(sent.text).toContain('hello');
    expect(sent.text).toContain('data:image/png;base64');
  });

  it('allows sending a message with pasted images and no text', async () => {
    render(<App />);
    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const textarea = screen.getByRole('textbox');
    await waitFor(() => expect(textarea).not.toBeDisabled());

    const file = new File([Uint8Array.from([1, 2, 3])], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
      },
    } as any);

    await waitFor(() => {
      expect(screen.getByAltText('pasted.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    const sent = await waitFor(() => {
      const msg = mockApi.postMessage.mock.calls
        .map((call: any[]) => call[0])
        .find((m: any) => m?.type === 'send');
      if (!msg) throw new Error('Missing send message');
      return msg;
    });

    expect(sent.text).toContain('![pasted.png](');
    expect(sent.text).toContain('data:image/png;base64');
  });

  it('renders markdown data:image as an <img>', async () => {
    render(<App />);
    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: '![preview](data:image/png;base64,AQID)' }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByAltText('preview')).toBeInTheDocument();
  });

  it('renders markdown vscode-webview-resource images as an <img>', async () => {
    render(<App />);
    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: '![local](vscode-webview-resource://test/pasted-images/abcd.png)' }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByAltText('local')).toBeInTheDocument();
  });

  it('does not render SVG data:image payloads', async () => {
    render(<App />);
    postToWindow({ type: 'status', status: 'online', mode: 'local' });

    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [{ type: 'text', text: '![bad](data:image/svg+xml;base64,AQID)' }],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(screen.queryByAltText('bad')).not.toBeInTheDocument();
    expect(await screen.findByText('bad')).toBeInTheDocument();
  });
});
