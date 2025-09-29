import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';

describe('App render', () => {
  it('renders header, input, and buttons', () => {
    render(<App />);
    expect(screen.getByText('OpenHands')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });
});
