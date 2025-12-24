import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from '../components/App';
import { postToWindow } from './testUtils';

describe('App - missing LLM API key', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error mock VS Code API
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a transient status banner for missing_llm_api_key conversation errors', async () => {
    render(<App />);

    postToWindow({
      type: 'event',
      event: {
        kind: 'ConversationErrorEvent',
        source: 'agent',
        code: 'missing_llm_api_key',
        detail: 'Missing API key for LLM provider',
      },
    });

    expect(await screen.findByText('Missing API key. Set it in LLM Profiles.')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('status-row')).toHaveTextContent('Missing API key. Set it in LLM Profiles.');
    });
  });
});

