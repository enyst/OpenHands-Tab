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
      tool_name: 'terminal',
      tool_call_id: 'call_123'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
  });

  it('renders conversation error events', async () => {
    render(<App />);
    const ev: ConversationErrorEvent = {
      type: 'ConversationErrorEvent',
      source: 'environment',
      code: 'LLMBadRequestError',
      detail: 'Unsupported value: reasoning effort too low'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Conversation Error/)).toBeInTheDocument();
    expect(await screen.findByText(/LLMBadRequestError/)).toBeInTheDocument();
    expect(await screen.findByText(/Unsupported value/)).toBeInTheDocument();
  });

  it('renders SystemPromptEvent', async () => {
    render(<App />);
    const ev = {
      type: 'SystemPromptEvent',
      source: 'agent' as const,
      system_prompt: { type: 'text' as const, text: 'You are a helpful AI assistant designed for testing' },
      tools: [{ name: 'bash' }, { name: 'read' }, { name: 'write' }]
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/You are a helpful AI assistant designed for testing/)).toBeInTheDocument();
    expect(await screen.findByText(/Tools Available: 3/)).toBeInTheDocument();
  });

  it('renders ActionEvent', async () => {
    render(<App />);
    const ev = {
      type: 'ActionEvent',
      source: 'agent' as const,
      thought: [{ type: 'text' as const, text: 'I will check the directory structure now' }],
      action: { command: 'ls -la /home' },
      tool_name: 'terminal',
      tool_call_id: 'call_action_1',
      tool_call: { id: 'call_action_1', type: 'function' as const, function: { name: 'terminal', arguments: '{}' } },
      llm_response_id: 'resp_action_1'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/I will check the directory structure now/)).toBeInTheDocument();
    expect(await screen.findByText(/terminal/)).toBeInTheDocument();
  });

  it('renders ObservationEvent', async () => {
    render(<App />);
    const ev = {
      type: 'ObservationEvent',
      source: 'environment' as const,
      observation: { content: 'Directory listing output from bash execution', exit_code: 0 },
      tool_name: 'terminal',
      tool_call_id: 'call_obs_1',
      action_id: 'action_obs_1'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Directory listing output from bash execution/)).toBeInTheDocument();
  });

  it('renders UserRejectObservation', async () => {
    render(<App />);
    const ev = {
      type: 'UserRejectObservation',
      source: 'user' as const,
      rejection_reason: 'This command appears to be potentially harmful to the system',
      tool_name: 'terminal',
      tool_call_id: 'call_reject_2',
      action_id: 'action_reject_2'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/This command appears to be potentially harmful to the system/)).toBeInTheDocument();
  });

  it('renders PauseEvent', async () => {
    render(<App />);
    const ev = {
      type: 'PauseEvent',
      source: 'user' as const
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/User Paused/)).toBeInTheDocument();
  });

  it('renders Condensation', async () => {
    render(<App />);
    const ev = {
      type: 'Condensation',
      source: 'agent' as const,
      forgotten_event_ids: ['ev1', 'ev2', 'ev3', 'ev4', 'ev5'],
      summary: 'Condensed multiple historical events to save memory'
    };
    postToWindow({ type: 'event', event: ev });
    expect(await screen.findByText(/Forgetting 5 events/)).toBeInTheDocument();
  });
});
