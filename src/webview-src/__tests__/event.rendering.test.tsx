import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import type {
  MessageEvent as AgentMessageEvent,
  AgentErrorEvent,
  ConversationErrorEvent,
} from '@openhands/agent-sdk-ts';

afterEach(() => {
  cleanup();
});

function postToWindow(payload: any) {
  window.postMessage(payload, '*');
}

describe('Agent-SDK event rendering', () => {
  it('renders text content from MessageEvent', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [ { type: 'text', text: 'Hello world' } ]
      }
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('renders user messages correctly', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'user',
      llm_message: {
        role: 'user',
        content: [ { type: 'text', text: 'User message here' } ]
      }
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('User message here')).toBeInTheDocument();
  });

  it('renders agent error events', async () => {
    render(<App />);
    const ev: AgentErrorEvent = {
      kind: 'AgentErrorEvent',
      source: 'agent',
      error: 'Something went wrong',
      tool_name: 'terminal',
      tool_call_id: 'call_123'
    } as any;
    postToWindow({ type: 'event', event: ev });
    // Error appears in both the event block and status banner
    const errorElements = await screen.findAllByText(/Something went wrong/);
    expect(errorElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders conversation error events', async () => {
    render(<App />);
    const ev: ConversationErrorEvent = {
      kind: 'ConversationErrorEvent',
      source: 'environment',
      code: 'LLMBadRequestError',
      detail: 'Unsupported value: reasoning effort too low'
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Conversation Error/)).toBeInTheDocument();
    expect(await screen.findByText(/LLMBadRequestError/)).toBeInTheDocument();
    expect(await screen.findByText(/Unsupported value/)).toBeInTheDocument();
  });

  it('renders SystemPromptEvent', async () => {
    render(<App />);
    const ev = {
      kind: 'SystemPromptEvent',
      source: 'agent' as const,
      system_prompt: { type: 'text' as const, text: 'You are a helpful AI assistant designed for testing' },
      tools: [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/You are a helpful AI assistant designed for testing/)).toBeInTheDocument();
    expect(await screen.findByText(/3 tools loaded/)).toBeInTheDocument();
  });

  it('renders ActionEvent', async () => {
    render(<App />);
    const ev = {
      kind: 'ActionEvent',
      source: 'agent' as const,
      thought: [{ type: 'text' as const, text: 'I will check the directory structure now' }],
      action: { command: 'ls -la /home' },
      tool_name: 'terminal',
      tool_call_id: 'call_action_1',
      tool_call: { id: 'call_action_1', type: 'function' as const, function: { name: 'terminal', arguments: '{}' } },
      llm_response_id: 'resp_action_1'
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/I will check the directory structure now/)).toBeInTheDocument();
    expect(await screen.findByText(/terminal/)).toBeInTheDocument();
  });

  it('renders ObservationEvent', async () => {
    render(<App />);
    const ev = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: { content: 'Directory listing output from bash execution', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_obs_1',
      action_id: 'action_obs_1'
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Directory listing output from bash execution/)).toBeInTheDocument();
  });

  it('renders UserRejectObservation', async () => {
    render(<App />);
    const ev = {
      kind: 'UserRejectObservation',
      source: 'user' as const,
      rejection_reason: 'This command appears to be potentially harmful to the system',
      tool_name: 'terminal',
      tool_call_id: 'call_reject_2',
      action_id: 'action_reject_2'
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/This command appears to be potentially harmful to the system/)).toBeInTheDocument();
  });

  it('renders PauseEvent in status bar only', async () => {
    render(<App />);
    const ev = {
      kind: 'PauseEvent',
      source: 'user' as const
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText('Conversation paused')).toBeInTheDocument();
    expect(await screen.findByText('Paused')).toBeInTheDocument();
  });

  it('renders Condensation', async () => {
    render(<App />);
    const ev = {
      kind: 'Condensation',
      source: 'agent' as const,
      forgotten_event_ids: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'],
      summary: 'Condensed multiple historical events to save memory'
    } as any;
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Memory Condensed/)).toBeInTheDocument();
    expect(await screen.findByText(/5 events/)).toBeInTheDocument();
  });
});
