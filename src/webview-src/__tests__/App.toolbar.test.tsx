import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('App toolbar interactions', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('requests skills on mount to populate badge', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestSkills' });
    });
  });

  it('shows the configured LLM profile in the input row', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'llmProfilesUpdated', profiles: ['gpt-4.1', 'gpt-5'], activeProfileId: 'gpt-4.1' }
      }));
    });

    expect(await screen.findByLabelText('LLM profile')).toHaveTextContent('gpt-4.1');
  });

  it('shows the effective model label when no LLM profile is configured', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'llmProfilesUpdated', profiles: ['gpt-4.1', 'gpt-5'], activeProfileId: null }
      }));
    });

    expect(await screen.findByLabelText('LLM profile')).toHaveTextContent('gpt-4.1');
  });

  it('updates the LLM profile when selected in the dropdown', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'llmProfilesUpdated', profiles: ['gpt-4.1', 'gpt-5'], activeProfileId: null }
      }));
    });

    fireEvent.click(await screen.findByLabelText('LLM profile'));
    fireEvent.click(await screen.findByText('gpt-5'));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'setLlmProfileId', profileId: 'gpt-5' });
  });

  it('requests workspace files and inserts context mention at cursor', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Type @ to trigger mention mode
    fireEvent.change(input, { target: { value: '@' } });
    // Simulate selection at end of input
    Object.defineProperty(input, 'selectionStart', { value: 1, configurable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 1, configurable: true });
    fireEvent.select(input);

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

    // The @ mention should be replaced with the file path
    await waitFor(() => {
      expect(input.value).toContain('@src/index.ts');
    });

    // Context picker should close
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
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

    const skillOption = screen.getByRole('option', { name: 'Example Skill' });
    const icon = skillOption.querySelector('.codicon-file-code');
    expect(icon).toBeTruthy();
    expect(icon).toHaveClass('text-brand-400/70');

    fireEvent.click(screen.getByText('Example Skill'));
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/skill.md' });
  });

  it('supports arrow navigation in workspace file picker', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: '@' } });
    Object.defineProperty(input, 'selectionStart', { value: 1, configurable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 1, configurable: true });
    fireEvent.select(input);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['a.txt', 'b.txt', 'c.txt'] }
      }));
    });

    const searchInput = await screen.findByPlaceholderText('Search files...');

    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(input.value).toContain('@b.txt');
    });
  });

  it('handles skill selection via keyboard', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByLabelText('Skills')[0]);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestSkills' });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'skillsList',
          skills: [
            { label: 'Skill One', path: '/tmp/skill1.md' },
            { label: 'Skill Two', path: '/tmp/skill2.md' },
          ],
        }
      }));
    });

    const searchInput = await screen.findByPlaceholderText('Search skills...');
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/skill2.md' });
    });
  });
});
