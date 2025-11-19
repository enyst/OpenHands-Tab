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
    expect(screen.getByPlaceholderText('Ask OpenHands anything...')).toBeInTheDocument();
    expect(screen.getByLabelText('New')).toBeInTheDocument();
    expect(screen.getByLabelText('Add context')).toBeInTheDocument();
  });
});
