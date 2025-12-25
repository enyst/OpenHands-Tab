import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('Tools picker', () => {
  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows tool count and toggles tools before the conversation starts', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'toolsList',
          tools: [
            { id: 'terminal', label: 'Terminal' },
            { id: 'file_editor', label: 'File Editor' },
            { id: 'task_tracker', label: 'Task Tracker' },
          ],
          enabledToolIds: ['terminal', 'file_editor', 'task_tracker'],
        }
      }));
    });

    const toolsButton = await screen.findByRole('button', { name: 'Tools' });
    expect(toolsButton).toHaveTextContent('3');

    mockApi.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(toolsButton);
    });
    // Opening the popover re-requests the tools list.
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestTools' });
    mockApi.postMessage.mockClear();

    const terminalRow = await screen.findByLabelText('Terminal');
    expect(terminalRow).toHaveAttribute('aria-selected', 'true');

    await act(async () => {
      fireEvent.click(terminalRow);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tools' })).toHaveTextContent('2');
    });

    expect(mockApi.postMessage).toHaveBeenCalledWith({
      type: 'setEnabledTools',
      toolIds: ['file_editor', 'task_tracker'],
    });
    expect(screen.getByLabelText('Terminal')).toHaveAttribute('aria-selected', 'false');
  });

  it('does not toggle tools after a user message and shows an info status message', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'toolsList',
          tools: [
            { id: 'terminal', label: 'Terminal' },
            { id: 'file_editor', label: 'File Editor' },
            { id: 'task_tracker', label: 'Task Tracker' },
          ],
          enabledToolIds: ['terminal', 'file_editor', 'task_tracker'],
        }
      }));
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Tools' }));
    });
    const terminalRow = await screen.findByLabelText('Terminal');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'event',
          event: {
            kind: 'MessageEvent',
            source: 'user',
            llm_message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          },
        }
      }));
    });

    mockApi.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(terminalRow);
    });

    expect(mockApi.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setEnabledTools' }));
    expect(screen.getByTestId('status-row')).toHaveTextContent('To change Tools, please start a new conversation.');
    expect(screen.getByLabelText('Terminal')).toHaveAttribute('aria-selected', 'true');
  });
});
