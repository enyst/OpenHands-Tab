import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('App toolbar interactions', () => {
  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('sends openSettingsPage when settings icon is clicked', () => {
    render(<App />);
    fireEvent.click(screen.getAllByLabelText('Settings')[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSettingsPage' });
  });

  it('requests workspace files and inserts context mention at cursor', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: '' } });
    Object.defineProperty(input, 'selectionStart', { value: 0, configurable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 0, configurable: true });
    fireEvent.select(input);

    fireEvent.click(screen.getByRole('button', { name: 'Context' }));

    // Wait for workspace files request
    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['src/index.ts', 'README.md'] }
      }));
    });

    // File picker should be open now
    expect(await screen.findByPlaceholderText('Search files...')).toBeInTheDocument();

    // Click on a file to select it
    fireEvent.click(screen.getByText('src/index.ts'));

    // The file mention should be inserted at the caret position
    await waitFor(() => {
      expect(input.value).toContain('@src/index.ts');
    });

    // Context picker should close
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
  });

  it('requests skills and opens selected skill file', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestSkills' });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'skillsList', skills: [{ label: 'Example Skill', path: '/tmp/skill.md' }] }
      }));
    });

    fireEvent.click(screen.getByText('Example Skill'));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/skill.md' });
  });

  it.skip('supports arrow navigation in workspace file picker', async () => {
    // Keyboard navigation is not implemented in the current design
    // Skipping this test until keyboard navigation is added
  });

  it.skip('handles skill selection via keyboard', async () => {
    // Keyboard navigation is not implemented in the current design
    // Skipping this test until keyboard navigation is added
  });
});
