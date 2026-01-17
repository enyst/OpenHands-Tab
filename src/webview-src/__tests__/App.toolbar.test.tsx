import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { App } from '../components/App';

const mockApi = { postMessage: vi.fn() };

describe('App toolbar interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  beforeEach(() => {
    vi.useRealTimers();
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

  it('opens and closes History view from the toolbar', async () => {
    render(<App />);
    mockApi.postMessage.mockClear();

    fireEvent.click(screen.getAllByLabelText('History')[0]);

    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestHistory' });
    expect(await screen.findByLabelText('Close history')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Close history'));

    await waitFor(() => {
      expect(screen.queryByLabelText('Close history')).not.toBeInTheDocument();
    });
  });

  it('shows and updates conversation totals from stats events', async () => {
    render(<App />);

    const totalsRow = await screen.findByTestId('header-totals-row');
    expect(totalsRow).toHaveTextContent('Context:');
    expect(totalsRow).toHaveTextContent('Total cost:');
    expect(totalsRow).toHaveTextContent('—');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'llm_usage',
              value: {
                input: 10,
                output: 5,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 10 tokens');
    expect(totalsRow).toHaveTextContent('Total cost:');
    expect(totalsRow).toHaveTextContent('—');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'stats',
              value: {
                usage_to_metrics: {
                  default: {
                    accumulated_cost: 0.0123,
                    accumulated_token_usage: { prompt_tokens: 10, completion_tokens: 5, per_turn_token: 999 },
                  },
                },
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 10 tokens');
    expect(totalsRow).toHaveTextContent('Total cost: $0.0123');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'llm_usage',
              value: {
                input: 12,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 12 tokens');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'stats',
              value: {
                usage_to_metrics: {
                  default: {
                    accumulated_cost: 0,
                    accumulated_token_usage: { prompt_tokens: 22, completion_tokens: 5, per_turn_token: 888 },
                  },
                },
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 12 tokens');
    expect(totalsRow).toHaveTextContent('Total cost:');
    expect(totalsRow).toHaveTextContent('Total cost: $0.00');
    expect(totalsRow).not.toHaveTextContent('—');
    expect(totalsRow).not.toHaveTextContent('$0.0123');
  });

  it('shows a queued-messages badge when sending while the agent is running', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'status', status: 'online', mode: 'remote', llmProfileLabel: 'gpt-5' },
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              agent_status: 'RUNNING',
              key: 'llm_usage',
              value: {
                input: 1,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          },
        }),
      );
    });

    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'queued-1' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(await screen.findByTestId('queued-messages-badge')).toHaveTextContent('1');

    fireEvent.change(input, { target: { value: 'queued-2' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    expect(await screen.findByTestId('queued-messages-badge')).toHaveTextContent('2');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'MessageEvent',
              source: 'user',
              llm_message: {
                role: 'user',
                content: [{ type: 'text', text: 'dequeued' }],
              },
            },
          },
        }),
      );
    });

    expect(await screen.findByTestId('queued-messages-badge')).toHaveTextContent('1');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              agent_status: 'PAUSED',
              key: 'llm_usage',
              value: {
                input: 1,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          },
        }),
      );
    });

    expect(screen.queryByTestId('queued-messages-badge')).not.toBeInTheDocument();
  });

  it('uses the main agent usage bucket for context tokens (not sum across usages)', async () => {
    render(<App />);

    const totalsRow = await screen.findByTestId('header-totals-row');

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'remote', llmProfileLabel: 'gpt-5' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'event',
          event: {
            kind: 'ConversationStateUpdateEvent',
            key: 'stats',
            value: {
              usage_to_metrics: {
                agent: {
                  accumulated_cost: 0.0123,
                  accumulated_token_usage: { prompt_tokens: 100, completion_tokens: 20, per_turn_token: 50 },
                },
                summarizer: {
                  accumulated_cost: 0.0004,
                  accumulated_token_usage: { prompt_tokens: 10, completion_tokens: 5, per_turn_token: 20 },
                },
              },
              usage_to_labels: {
                agent: 'gpt-5',
                summarizer: 'gemini-flash-summarizer',
              },
            },
          },
        },
      }));
    });

    expect(totalsRow).toHaveTextContent('Context: 50 tokens');
    expect(totalsRow).toHaveTextContent('Total cost: $0.0127');
  });

  it('resets llm usage guard when starting a new conversation', async () => {
    render(<App />);

    const totalsRow = await screen.findByTestId('header-totals-row');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'llm_usage',
              value: {
                input: 10,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 10 tokens');

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Start new conversation'));
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            event: {
              kind: 'ConversationStateUpdateEvent',
              key: 'stats',
              value: {
                usage_to_metrics: {
                  agent: {
                    accumulated_cost: 0,
                    accumulated_token_usage: { prompt_tokens: 1, completion_tokens: 0, per_turn_token: 7 },
                  },
                },
              },
            },
          },
        }),
      );
    });

    expect(totalsRow).toHaveTextContent('Context: 7 tokens');
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

  it('shows a selector prompt when no active LLM profile is configured', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'llmProfilesUpdated', profiles: ['gpt-4.1', 'gpt-5'], activeProfileId: null }
      }));
    });

    const profileButton = await screen.findByLabelText('LLM profile');
    expect(profileButton).toHaveTextContent('Select profile…');
  });

  it('shows a selector prompt when the active LLM profile is missing from the list', async () => {
    render(<App />);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'llmProfilesUpdated', profiles: ['gpt-5'], activeProfileId: 'missing-profile' }
      }));
    });

    const profileButton = await screen.findByLabelText('LLM profile');
    expect(profileButton).toHaveTextContent('Select profile…');
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

  it('does not open the context picker for email addresses', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
      }));
    });

    mockApi.postMessage.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: 'engel@gmail.com' } });
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.select(input);

    expect(mockApi.postMessage).not.toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
  });

  it('does not steal focus when opening the mention context picker', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
      }));
    });

    mockApi.postMessage.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: '@' } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['src/index.ts', 'README.md'] }
      }));
    });

    expect(await screen.findByPlaceholderText('Search files...')).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('closes the mention context picker when clicking back into the input', async () => {
    vi.useFakeTimers();
    try {
      render(<App />);
      const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
      expect(input).toBeTruthy();

      await act(async () => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
        }));
      });

      mockApi.postMessage.mockClear();
      act(() => {
        input.focus();
        fireEvent.change(input, { target: { value: '@' } });
        input.setSelectionRange(1, 1);
        fireEvent.select(input);
      });

      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
      expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();

      // Wait for the close handler to be attached (100ms delay in useCloseOnEscapeAndOutsideClick)
      act(() => { vi.advanceTimersByTime(150); });

      act(() => {
        fireEvent.click(input);
      });

      expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(input);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the context picker on Esc and returns focus to the input', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'status', status: 'online', mode: 'local', llmProfileLabel: 'gpt-4.1' }
      }));
    });

    fireEvent.change(input, { target: { value: '@' } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'workspaceFiles', files: ['src/index.ts', 'README.md'] }
      }));
    });

    const searchInput = await screen.findByPlaceholderText('Search files...');
    fireEvent.keyDown(searchInput, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);

    // Selecting/focusing the input should not immediately reopen the picker and steal focus back.
    fireEvent.select(input);
    expect(screen.queryByPlaceholderText('Search files...')).not.toBeInTheDocument();
  });

  it('does not open the context picker when @ is mid-word (email address)', async () => {
    render(<App />);
    const input = document.getElementById('openhands-chat-input') as HTMLTextAreaElement;
    expect(input).toBeTruthy();

    const value = 'engel@gmail.com';
    input.setSelectionRange(value.length, value.length);
    fireEvent.select(input);
    fireEvent.change(input, { target: { value } });

    await waitFor(() => {
      expect(mockApi.postMessage).not.toHaveBeenCalledWith({ type: 'requestWorkspaceFiles' });
    });
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
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    await waitFor(() => {
      expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openSkill', path: '/tmp/skill2.md' });
    });
  });
});
