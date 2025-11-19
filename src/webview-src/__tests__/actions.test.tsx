import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('App actions post messages to extension', () => {
  beforeEach(() => {
    mockApi.postMessage.mockClear();
    // @ts-expect-error define VS Code API mock on window
    window.acquireVsCodeApi = () => mockApi;
  });

  it('Settings posts openSettingsPage', async () => {
    render(<App />);
    await userEvent.click(screen.getAllByLabelText(/settings/i)[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSettingsPage' });
  });

  it('Reconnect posts command reconnect', async () => {
    render(<App />);
    await userEvent.click(screen.getAllByLabelText(/reconnect/i)[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'reconnect' });
  });

  it('New Chat posts command startNewConversation', async () => {
    render(<App />);
    await userEvent.click(screen.getAllByLabelText(/new/i)[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'startNewConversation' });
  });

  it('Pressing Enter posts send with typed text and closes context picker', async () => {
    render(<App />);

    // Set status to online so input is enabled
    await act(async () => {
      window.postMessage({ type: 'status', status: 'online', mode: 'remote' }, '*');
    });

    await userEvent.click(screen.getAllByLabelText('Add context')[0]);
    expect(await screen.findByPlaceholderText('Search files...')).toBeInTheDocument();

    const input = document.getElementById('openhands-chat-input');
    expect(input).toBeTruthy();
    await userEvent.type(input as HTMLInputElement, 'hello{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'hello' });
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
  });

  it('sending a message closes the skills popover', async () => {
    render(<App />);

    // Set status to online so input is enabled
    await act(async () => {
      window.postMessage({ type: 'status', status: 'online', mode: 'remote' }, '*');
    });

    await userEvent.click(screen.getAllByLabelText('Skills')[0]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'skillsList',
          skills: [
            { label: 'Alpha', path: '/tmp/a.md' }
          ]
        }
      }));
    });

    mockApi.postMessage.mockClear();
    const input = document.getElementById('openhands-chat-input');
    expect(input).toBeTruthy();
    await userEvent.type(input as HTMLInputElement, 'ping{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'ping' });
    expect(screen.queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument();
  });
});
