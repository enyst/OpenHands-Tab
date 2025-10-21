import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type { MessageEvent as AgentMessageEvent, AgentErrorEvent } from '../../types/agent-sdk';

function postToWindow(payload: any) {
  window.postMessage(payload, '*');
}

describe('Agent-SDK event rendering', () => {
  it('renders text content from MessageEvent', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      type: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [ { type: 'text', text: 'Hello world' } ]
      }
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('renders user messages correctly', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      type: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [ { type: 'text', text: 'User message here' } ]
      }
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('User message here')).toBeInTheDocument();
  });

  it('renders agent error events', async () => {
    render(<App />);
    const ev: AgentErrorEvent = {
      type: 'AgentErrorEvent',
      source: 'agent',
      error: 'Something went wrong',
      tool_name: 'BashTool',
      tool_call_id: 'call_123'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });
});
