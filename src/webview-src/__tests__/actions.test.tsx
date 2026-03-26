import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { App } from '../components/App';
import { postToWindow } from './testUtils';

const mockApi = { postMessage: vi.fn() };

describe('App actions post messages to extension', () => {
  beforeEach(() => {
    mockApi.postMessage.mockClear();
    // @ts-expect-error define VS Code API mock on window
    window.acquireVsCodeApi = () => mockApi;
  });

  afterEach(() => {
    cleanup();
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

  it('Attachments posts selectAttachments', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();
    await userEvent.click(screen.getByLabelText('Attachments'));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'selectAttachments' });
  });

  it('Pressing Enter posts send with typed text and closes context picker', async () => {
    render(<App />);

    // Set status to online so input is enabled
    postToWindow({ type: 'status', status: 'online', mode: 'remote' });

    await userEvent.click(screen.getAllByLabelText('Add context')[0]);
    expect(await screen.findByPlaceholderText('Search files...')).toBeInTheDocument();

    const input = document.getElementById('openhands-chat-input');
    expect(input).toBeTruthy();
    await userEvent.type(input as HTMLInputElement, 'hello{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'hello', contextFiles: [], attachments: [] });
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
  });

  it('sending a message closes the skills popover', async () => {
    render(<App />);

    // Set status to online so input is enabled
    postToWindow({ type: 'status', status: 'online', mode: 'remote' });

    await userEvent.click(screen.getAllByLabelText('Skills')[0]);

    postToWindow({
      type: 'skillsList',
      skills: [
        { label: 'Alpha', path: '/tmp/a.md' },
      ],
    });

    mockApi.postMessage.mockClear();
    const input = document.getElementById('openhands-chat-input');
    expect(input).toBeTruthy();
    await userEvent.type(input as HTMLInputElement, 'ping{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'ping', contextFiles: [], attachments: [] });
    expect(screen.queryByRole('listbox', { name: 'Skills' })).not.toBeInTheDocument();
  });

  it('reselecting the active LLM profile does not delay sends', async () => {
    render(<App />);

    postToWindow({ type: 'status', status: 'online', mode: 'local' });
    postToWindow({ type: 'llmProfilesUpdated', profiles: ['gpt-5'], activeProfileId: 'gpt-5' });

    mockApi.postMessage.mockClear();

    fireEvent.click(await screen.findByLabelText('LLM profile'));
    fireEvent.click(await screen.findByLabelText('Select profile gpt-5'));

    expect(mockApi.postMessage).not.toHaveBeenCalledWith({ type: 'setLlmProfileId', profileId: 'gpt-5' });

    const input = document.getElementById('openhands-chat-input');
    expect(input).toBeTruthy();
    await userEvent.type(input as HTMLInputElement, 'hello again{enter}');

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'send', text: 'hello again', contextFiles: [], attachments: [] });
  });
});
