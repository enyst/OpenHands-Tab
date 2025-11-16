import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('App toolbar interactions', () => {
  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  it('sends openSettingsPage when settings icon is clicked', () => {
    render(<App />);
    fireEvent.click(screen.getAllByLabelText('Settings')[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSettingsPage' });
  });

  it('requests workspace files and inserts context mention at cursor', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Review this' } });
    fireEvent.focus(input);
    input.setSelectionRange(7, 7);
    fireEvent.select(input, { target: { selectionStart: 7, selectionEnd: 7 } });

    fireEvent.click(screen.getAllByLabelText('Add context')[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['src/index.ts', 'README.md'] }
      }));
    });

    fireEvent.change(await screen.findByPlaceholderText('Search workspace files'), { target: { value: 'src' } });
    fireEvent.click(screen.getByText('src/index.ts'));

    expect(input.value).toBe('Review @src/index.ts this');
    expect(screen.queryByPlaceholderText('Search workspace files')).not.toBeInTheDocument();
  });

  it('requests skills and opens selected skill file', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByLabelText('Skills')[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestSkills' });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'skillsList', skills: [{ label: 'Example Skill', path: '/tmp/skill.md' }] }
      }));
    });

    fireEvent.click(screen.getByText('Example Skill'));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/skill.md' });
  });

  it('supports arrow navigation in workspace file picker', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByLabelText('Add context')[0]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['README.md', 'src/index.ts'] }
      }));
    });

    const queryInput = await screen.findByPlaceholderText('Search workspace files');
    fireEvent.keyDown(queryInput, { key: 'ArrowDown' });

    expect(screen.getByRole('option', { name: 'README.md' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'src/index.ts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('handles skill selection via keyboard', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByLabelText('Skills')[0]);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'skillsList',
          skills: [
            { label: 'Alpha', path: '/tmp/alpha.md' },
            { label: 'Beta', path: '/tmp/beta.md' }
          ]
        }
      }));
    });

    mockApi.postMessage.mockClear();

    const skillsList = await screen.findByRole('listbox', { name: 'Skills' });
    fireEvent.keyDown(skillsList, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(skillsList, { key: 'Enter' });
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/beta.md' });
  });
});
