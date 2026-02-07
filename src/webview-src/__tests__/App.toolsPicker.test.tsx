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
            { id: 'finish', label: 'Finish' },
          ],
          enabledToolIds: ['terminal', 'file_editor', 'task_tracker', 'finish'],
        }
      }));
    });

    const toolsButton = await screen.findByRole('button', { name: 'Tools' });
    expect(toolsButton).toHaveTextContent('4');

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
      expect(screen.getByRole('button', { name: 'Tools' })).toHaveTextContent('3');
    });

    const setEnabledToolsCalls = mockApi.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message): message is { type: string; toolIds?: string[] } => (
        typeof message === 'object'
        && message !== null
        && (message as { type?: unknown }).type === 'setEnabledTools'
      ));
    expect(setEnabledToolsCalls).toEqual([{
      type: 'setEnabledTools',
      toolIds: ['file_editor', 'task_tracker', 'finish'],
    }]);
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
            { id: 'finish', label: 'Finish' },
          ],
          enabledToolIds: ['terminal', 'file_editor', 'task_tracker', 'finish'],
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

  it('shows tools in remote mode as read-only', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'remote' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'toolsList',
          tools: [
            { id: 'execute_bash', label: 'execute_bash' },
            { id: 'file_edit', label: 'file_edit' },
            { id: 'finish', label: 'finish' },
          ],
          enabledToolIds: ['execute_bash', 'file_edit', 'finish'],
        }
      }));
    });

    const toolsButton = await screen.findByRole('button', { name: 'Tools' });
    expect(toolsButton).toHaveTextContent('3');

    mockApi.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(toolsButton);
    });
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestTools' });

    expect(await screen.findByText(/controlled by the agent-server/i)).toBeInTheDocument();

    const bashRow = await screen.findByLabelText('execute_bash');
    expect(bashRow).toBeDisabled();
    expect(bashRow).toHaveAttribute('aria-selected', 'true');
  });

  it('does not emit setEnabledTools when host updates tool selection', async () => {
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
            { id: 'finish', label: 'Finish' },
          ],
          enabledToolIds: ['terminal', 'file_editor', 'finish'],
        }
      }));
    });

    mockApi.postMessage.mockClear();
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'toolsList',
          tools: [
            { id: 'terminal', label: 'Terminal' },
            { id: 'file_editor', label: 'File Editor' },
            { id: 'finish', label: 'Finish' },
          ],
          enabledToolIds: ['terminal', 'finish'],
        }
      }));
    });

    expect(mockApi.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setEnabledTools' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tools' })).toHaveTextContent('2');
    });
  });
});
