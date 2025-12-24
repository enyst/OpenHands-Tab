import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { App } from '../components/App';
import { postToWindow } from './testUtils';
import type {
  MessageEvent as AgentMessageEvent,
  AgentErrorEvent,
  ConversationErrorEvent,
} from '@openhands/agent-sdk-ts';

afterEach(() => {
  cleanup();
});

const mockApi = { postMessage: vi.fn() } as any;

beforeEach(() => {
  // @ts-expect-error -- VS Code API is injected by host environment during runtime
  window.acquireVsCodeApi = () => mockApi;
  mockApi.postMessage.mockClear();
});

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
    expect(await screen.findByText('OpenHands says')).toBeInTheDocument();
  });

  it('renders message markdown (inline code, fenced code, links)', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: [
              'Use `npm test` to run unit tests.',
              '',
              '```ts',
              "console.log('hi');",
              '```',
              '',
              'See [docs](https://example.com).',
            ].join('\n'),
          },
        ],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    const inlineCode = await screen.findByText('npm test');
    expect(inlineCode.tagName).toBe('CODE');

    const fenced = await screen.findByText(/console\.log/);
    expect(fenced.closest('pre')).not.toBeNull();

    const link = await screen.findByRole('button', { name: 'docs' });
    fireEvent.click(link);
    expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'openMarkdownLink', href: 'https://example.com' });
  });

  it('keeps attachment blocks as preformatted text', async () => {
    render(<App />);
    const ev: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: [
              'Hello',
              '',
              '----- BEGIN ATTACHMENT: foo.txt -----',
              '**bold**',
              '----- END ATTACHMENT: foo.txt -----',
            ].join('\n'),
          },
        ],
      },
    } as any;

    postToWindow({ type: 'event', event: ev });

    expect(await screen.findByText('Hello')).toBeInTheDocument();
    const messageBlock = await screen.findByTestId('message-event');
    expect(within(messageBlock).getByText('Attachments')).toBeInTheDocument();

    const summary = within(messageBlock).getByText('foo.txt');
    fireEvent.click(summary);

    const attachmentText = within(messageBlock).getByText('**bold**');
    expect(attachmentText.closest('pre')).not.toBeNull();
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
    expect(screen.queryByText('User')).toBeNull();
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
    const details = await screen.findByText(/Details/);
    fireEvent.click(details);
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
    const toggle = await screen.findByRole('button', { name: /Show system prompt/i });
    fireEvent.click(toggle);
    expect(await screen.findByText(/You are a helpful AI assistant designed for testing/)).toBeInTheDocument();
    expect(await screen.findByText(/3 tools available/)).toBeInTheDocument();
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
    expect((await screen.findAllByText(/terminal/)).length).toBeGreaterThan(0);
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
    const toggle = await screen.findByRole('button', { name: /Show tool result/i });
    fireEvent.click(toggle);
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
    // PauseEvent shows in status bar, not in event stream
    expect(await screen.findByText(/Conversation paused/)).toBeInTheDocument();
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
    expect(await screen.findByText(/Forgetting 5 events/)).toBeInTheDocument();
  });

  it('renders friendly summaries for file_editor events', async () => {
    render(<App />);
    const actionEvent = {
      kind: 'ActionEvent',
      source: 'agent' as const,
      thought: [{ type: 'text' as const, text: 'Checking the README' }],
      action: { command: 'view', path: '/tmp/README.md', view_range: [1, 5] },
      tool_name: 'file_editor',
      tool_call_id: 'call_file_editor_1',
      tool_call: { id: 'call_file_editor_1', type: 'function' as const, function: { name: 'file_editor', arguments: '{}' } },
      llm_response_id: 'resp_file_editor_1',
    } as any;
    postToWindow({ type: 'event', event: actionEvent });
    expect(await screen.findByText(/The agent wants to read/)).toBeInTheDocument();

    const observationEvent = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: {
        command: 'view',
        path: '/tmp/README.md',
        prev_exist: true,
        old_content: 'SECRET FILE CONTENT',
        new_content: '1\tSECRET FILE CONTENT',
      },
      tool_name: 'file_editor',
      tool_call_id: 'call_file_editor_1',
      action_id: 'action_file_editor_1',
    } as any;
    postToWindow({ type: 'event', event: observationEvent });
    expect(await screen.findByText(/Agent read/)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET FILE CONTENT/)).toBeNull();
  });

  it('opens a VS Code diff for file_editor edit observations', async () => {
    render(<App />);

    const observationEvent = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: {
        command: 'str_replace',
        path: '/tmp/README.md',
        prev_exist: true,
        old_content: 'old content',
        new_content: 'new content',
      },
      tool_name: 'file_editor',
      tool_call_id: 'call_file_editor_diff',
      action_id: 'action_file_editor_diff',
    } as any;

    postToWindow({ type: 'event', event: observationEvent });
    const button = await screen.findByRole('button', { name: 'View diff for /tmp/README.md' });
    fireEvent.click(button);

    expect(mockApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'openWorkspaceDiff',
        path: '/tmp/README.md',
        oldContent: 'old content',
        newContent: 'new content',
        preferGitHead: true,
      })
    );
  });

  it('allows viewing raw file_editor payloads on demand', async () => {
    render(<App />);
    const observationEvent = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: {
        command: 'view',
        path: '/tmp/README.md',
        prev_exist: true,
        old_content: 'SECRET FILE CONTENT',
        new_content: '1\tSECRET FILE CONTENT',
      },
      tool_name: 'file_editor',
      tool_call_id: 'call_file_editor_2',
      action_id: 'action_file_editor_2',
    } as any;
    postToWindow({ type: 'event', event: observationEvent });
    await screen.findByText(/Agent read/);
    const toggle = await screen.findByRole('button', { name: /Show tool result/i });
    expect(screen.queryByText(/SECRET FILE CONTENT/)).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText(/SECRET FILE CONTENT/)).toBeInTheDocument();
  });
  it('renders friendly summaries for terminal events', async () => {
    render(<App />);
    const actionEvent = {
      kind: 'ActionEvent',
      source: 'agent' as const,
      thought: [{ type: 'text' as const, text: 'Running ls' }],
      action: { command: 'ls -la' },
      tool_name: 'terminal',
      tool_call_id: 'call_terminal_action',
      tool_call: { id: 'call_terminal_action', type: 'function' as const, function: { name: 'terminal', arguments: '{"command":"ls -la"}' } },
      llm_response_id: 'resp_terminal_action',
    } as any;
    postToWindow({ type: 'event', event: actionEvent });
    expect(await screen.findByText(/The agent wants to execute a terminal command/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ls -la/)).toHaveLength(1);

    const observationEvent = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: {
        command: 'ls -la',
        exit_code: 0,
        stdout: 'README.md',
        summary: 'Listed the working directory contents and printed README.md.',
      },
      tool_name: 'terminal',
      tool_call_id: 'call_terminal_action',
      action_id: 'action_terminal_action',
    } as any;
    postToWindow({ type: 'event', event: observationEvent });
    expect(await screen.findByText(/Listed the working directory contents/i)).toBeInTheDocument();
    expect(screen.queryByText(/Done\./i)).toBeNull();
    expect(screen.getAllByText(/ls -la/)).toHaveLength(1);

    const toggle = await screen.findByRole('button', { name: /Show tool result/i });
    fireEvent.click(toggle);
    expect(await screen.findByText(/"stdout": "README\.md"/)).toBeInTheDocument();
  });

  it('falls back to Done for terminal observations without summary', async () => {
    render(<App />);
    const observationEvent = {
      kind: 'ObservationEvent',
      source: 'environment' as const,
      observation: {
        command: 'echo hello',
        exit_code: 0,
        stdout: 'hello',
      },
      tool_name: 'terminal',
      tool_call_id: 'call_terminal_fallback',
      action_id: 'action_terminal_fallback',
    } as any;

    postToWindow({ type: 'event', event: observationEvent });
    expect(await screen.findByText(/Done\./i)).toBeInTheDocument();

    const toggle = await screen.findByRole('button', { name: /Show tool result/i });
    fireEvent.click(toggle);
    expect(await screen.findByText(/hello/)).toBeInTheDocument();
  });




  it('suppresses tool role message events', async () => {
    render(<App />);
    const toolEvent: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'environment',
      llm_message: {
        role: 'tool',
        content: [{ type: 'text', text: 'Internal tool payload' }],
        name: 'file_editor',
        tool_call_id: 'call_tool_1',
      },
    } as any;
    postToWindow({ type: 'event', event: toolEvent });
    await waitFor(() => {
      expect(screen.queryByText(/Internal tool payload/)).toBeNull();
    });
  });

  it('hides assistant tool-call placeholder messages', async () => {
    render(<App />);
    const assistantToolCall: AgentMessageEvent = {
      kind: 'MessageEvent',
      source: 'agent',
      llm_message: {
        role: 'assistant',
        content: [{ type: 'text', text: '   ' }],
        tool_calls: [
          {
            id: 'tool_call_1',
            type: 'function',
            function: { name: 'terminal', arguments: '{"command":"ls"}' },
          },
        ],
      },
    } as any;
    postToWindow({ type: 'event', event: assistantToolCall });
    await waitFor(() => {
      expect(screen.queryAllByTestId('message-event')).toHaveLength(0);
    });
  });

});
