import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('Settings posts openSettings', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSettings' });
  });

  it('Reconnect posts command reconnect', async () => {
    render(<App />);
    const btn = screen.getAllByRole('button', { name: /reconnect/i })[0];
    await userEvent.click(btn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'reconnect' });
  });

  it('New Chat posts command startNewConversation', async () => {
    render(<App />);
    const btn = screen.getAllByRole('button', { name: /new chat/i })[0];
    await userEvent.click(btn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'startNewConversation' });
  });

  it('Stop posts command pause', async () => {
    render(<App />);
    const btn = screen.getAllByRole('button', { name: /stop/i })[0];
    await userEvent.click(btn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'pause' });
  });

  it('Send posts send with typed text', async () => {
    render(<App />);
    const input = screen.getAllByPlaceholderText(/type a message/i)[0];
    await userEvent.type(input, 'hello');
    const btn = screen.getAllByRole('button', { name: /send/i })[0];
    await userEvent.click(btn);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'hello' });
  });
});
