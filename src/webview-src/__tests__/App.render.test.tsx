import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

describe('App render', () => {
  const mockApi = { postMessage: vi.fn() };

  beforeEach(() => {
    // @ts-expect-error mock VS Code API for tests
    window.acquireVsCodeApi = () => mockApi;
    mockApi.postMessage.mockClear();
  });

  it('renders header, input, and toolbar controls', () => {
    render(<App />);
    expect(screen.getByText('OpenHands')).toBeInTheDocument();
    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(screen.getByLabelText('New Conversation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Context' })).toBeInTheDocument();
  });
});
