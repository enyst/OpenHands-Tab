import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type { MessageEvent as AgentMessageEvent, SystemEvent, ErrorEvent } from '../../types/agent-sdk';

function postToWindow(payload: any) {
  window.postMessage(payload, '*');
}

describe('Typed event rendering', () => {
  it('renders text content from message events', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      type: 'message',
      message: {
        role: 'assistant',
        content: [ { type: 'text', text: 'Hello world' } ]
      }
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('renders system messages', async () => {
    render(<App />);
    const ev: SystemEvent = { type: 'system', message: 'System notice' };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('System notice')).toBeInTheDocument();
  });

  it('renders error messages', async () => {
    render(<App />);
    const ev: ErrorEvent = { type: 'error', error: 'Boom' };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('Error: Boom')).toBeInTheDocument();
  });
});
