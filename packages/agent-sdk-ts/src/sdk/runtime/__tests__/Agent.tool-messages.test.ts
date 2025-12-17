import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isMessageEvent, type TextContent } from '../../types';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';
import { SecretRegistry } from '../SecretRegistry';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

const workspaceRoots: string[] = [];

const createWorkspaceRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-messages-'));
  workspaceRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of workspaceRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Agent tool message formatting', () => {
  it('formats terminal tool output as plain text and masks configured secrets', async () => {
    const secretValue = 'ghp_TOPSECRET1234567890';
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: { githubToken: secretValue },
    };
    const log = new EventLog();

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'echo hello',
        exit_code: 0,
        stdout: `hello ${secretValue}`,
        stderr: '',
        timeout: false,
      }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Running terminal' },
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"echo hello"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run terminal');

    const toolMessages = log
      .list()
      .filter(isMessageEvent)
      .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
    expect(toolMessages).toHaveLength(1);

    const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
    expect(text).toContain('hello');
    expect(text).not.toContain(secretValue);
    expect(text).toContain('***');
    expect(text.trimStart().startsWith('{')).toBe(false);

    const observations = log.list().filter((evt) => evt.kind === 'ObservationEvent');
    expect(observations).toHaveLength(1);
    const observation = observations[0] as unknown as { observation?: Record<string, unknown> };
    expect(JSON.stringify(observation.observation)).not.toContain(secretValue);
    expect(JSON.stringify(observation.observation)).toContain('***');
  });

  it('preserves non-plain tool results in ObservationEvent payloads', async () => {
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();
    const date = new Date('2025-01-02T03:04:05.000Z');

    const tool: ToolDefinition<Record<string, unknown>, unknown> = {
      name: 'date_tool',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => date,
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Returning a date' },
      { type: 'tool_call_delta', id: 'call_date', name: 'date_tool', arguments: '{}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run date tool');

    const observations = log.list().filter((evt) => evt.kind === 'ObservationEvent');
    expect(observations).toHaveLength(1);
    const observation = observations[0] as unknown as { observation?: Record<string, unknown> };
    expect(observation.observation?.value).toBeInstanceOf(Date);
    expect(JSON.stringify(observation.observation)).toContain('2025-01-02T03:04:05.000Z');
  });

  it('masks secrets inside class-instance tool results in ObservationEvent payloads', async () => {
    const secretValue = 'ghp_CLASSSECRET1234567890';
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: { githubToken: secretValue },
    };
    const log = new EventLog();

    class ResultWithSecret {
      constructor(
        readonly token: string,
        readonly notes: string,
      ) {}
    }

    const tool: ToolDefinition<Record<string, unknown>, unknown> = {
      name: 'custom_result',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => new ResultWithSecret(secretValue, 'x'.repeat(2100)),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Returning a class instance' },
      { type: 'tool_call_delta', id: 'call_custom', name: 'custom_result', arguments: '{}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run custom tool');

    const observations = log.list().filter((evt) => evt.kind === 'ObservationEvent');
    expect(observations).toHaveLength(1);
    const observation = observations[0] as unknown as { observation?: Record<string, unknown> };
    expect(JSON.stringify(observation.observation)).not.toContain(secretValue);
    expect(JSON.stringify(observation.observation)).toContain('***');
    expect(JSON.stringify(observation.observation)).toContain('…(truncated)');
  });

  it('masks uppercase secrets even when they resemble env var names', async () => {
    const secretValue = 'TOPSECRETUPPERCASE1234567890';
    const envKey = secretValue;
    const previousEnvValue = process.env[envKey];
    delete process.env[envKey];

    try {
      const settings: OpenHandsSettings = {
        llm: { model: 'test-model' },
        agent: {},
        conversation: { maxIterations: 1 },
        confirmation: {},
        secrets: { githubToken: secretValue },
      };
      const log = new EventLog();

      const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
        name: 'terminal',
        validate: (input) => input as Record<string, unknown>,
        execute: async () => ({
          command: 'echo hello',
          exit_code: 0,
          stdout: `hello ${secretValue}`,
          stderr: '',
          timeout: false,
        }),
      };

      const llm = new MockLLM([
        { type: 'text', text: 'Running terminal' },
        { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"echo hello"}' },
        { type: 'finish' },
      ]);

      const agent = new Agent({
        settings,
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('run terminal');

      const toolMessages = log
        .list()
        .filter(isMessageEvent)
        .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
      expect(toolMessages).toHaveLength(1);

      const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
      expect(text).not.toContain(secretValue);
      expect(text).toContain('***');
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousEnvValue;
      }
    }
  });

  it('masks uppercase secrets when an env var of the same name exists with a different value', async () => {
    const secretValue = 'TOPSECRETUPPERCASE1234567890';
    const envKey = secretValue;
    const envValue = 'DIFFERENT_ENV_SECRET_1234567890';
    const previousEnvValue = process.env[envKey];
    process.env[envKey] = envValue;

    try {
      const settings: OpenHandsSettings = {
        llm: { model: 'test-model' },
        agent: {},
        conversation: { maxIterations: 1 },
        confirmation: {},
        secrets: { githubToken: secretValue },
      };
      const log = new EventLog();

      const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
        name: 'terminal',
        validate: (input) => input as Record<string, unknown>,
        execute: async () => ({
          command: 'echo hello',
          exit_code: 0,
          stdout: `hello ${secretValue} ${envValue}`,
          stderr: '',
          timeout: false,
        }),
      };

      const llm = new MockLLM([
        { type: 'text', text: 'Running terminal' },
        { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"echo hello"}' },
        { type: 'finish' },
      ]);

      const agent = new Agent({
        settings,
        events: log,
        workspaceRoot: createWorkspaceRoot(),
        llmClient: llm,
        tools: [tool],
      });

      await agent.run('run terminal');

      const toolMessages = log
        .list()
        .filter(isMessageEvent)
        .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
      expect(toolMessages).toHaveLength(1);

      const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
      expect(text).not.toContain(secretValue);
      expect(text).not.toContain(envValue);
      expect(text).toContain('***');
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousEnvValue;
      }
    }
  });

  it('truncates long terminal tool outputs using <response clipped>', async () => {
    const log = new EventLog();
    const longOutput = 'A'.repeat(35_000);
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ command: 'echo big', exit_code: 0, stdout: longOutput, stderr: '' }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Big output' },
      { type: 'tool_call_delta', id: 'call_terminal_big', name: 'terminal', arguments: '{"command":"echo big"}' },
      { type: 'finish' },
    ]);
    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run big');

    const toolMessages = log
      .list()
      .filter(isMessageEvent)
      .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
    expect(toolMessages).toHaveLength(1);

    const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
    expect(text).toContain('<response clipped>');
    expect(text.length).toBeLessThan(longOutput.length);
    expect(text.length).toBeLessThanOrEqual(8_000);
  });

  it('masks secrets registered in SecretRegistry', async () => {
    const secretValue = 'tok_SUPERSECRET_1234567890';
    const registry = new SecretRegistry();
    registry.register('custom', secretValue);

    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const log = new EventLog();

    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'echo hi',
        exit_code: 0,
        stdout: `leak ${secretValue}`,
        stderr: '',
      }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Run terminal' },
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"echo hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
      secrets: registry,
    });

    await agent.run('run');

    const toolMessages = log
      .list()
      .filter(isMessageEvent)
      .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
    expect(toolMessages).toHaveLength(1);

    const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
    expect(text).not.toContain(secretValue);
    expect(text).toContain('***');
  });

  it('parses terminal command from tool call args when tool result omits it', async () => {
    const log = new EventLog();
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'terminal',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ stdout: 'ok', stderr: '', exit_code: 0 }),
    };
    const llm = new MockLLM([
      { type: 'text', text: 'Run terminal' },
      { type: 'tool_call_delta', id: 'call_terminal', name: 'terminal', arguments: '{"command":"echo hello"}' },
      { type: 'finish' },
    ]);
    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run');

    const toolMessages = log
      .list()
      .filter(isMessageEvent)
      .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'terminal');
    expect(toolMessages).toHaveLength(1);

    const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
    expect(text).toContain('$ echo hello');
    expect(text).not.toContain('{"command"');
  });

  it('formats file_editor tool output as plain text', async () => {
    const log = new EventLog();
    const settings: OpenHandsSettings = {
      llm: { model: 'test-model' },
      agent: {},
      conversation: { maxIterations: 1 },
      confirmation: {},
      secrets: {},
    };
    const tool: ToolDefinition<Record<string, unknown>, Record<string, unknown>> = {
      name: 'file_editor',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({
        command: 'view',
        path: 'note.txt',
        prev_exist: true,
        old_content: 'line-1\nline-2',
        new_content: '1\tline-1\n2\tline-2',
      }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'View file' },
      { type: 'tool_call_delta', id: 'call_view', name: 'file_editor', arguments: '{"command":"view","path":"note.txt"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('view');

    const toolMessages = log
      .list()
      .filter(isMessageEvent)
      .filter((evt) => evt.llm_message.role === 'tool' && evt.llm_message.name === 'file_editor');
    expect(toolMessages).toHaveLength(1);

    const text = (toolMessages[0].llm_message.content[0] as TextContent).text;
    expect(text).toContain('1\tline-1');
    expect(text.trimStart().startsWith('{')).toBe(false);
  });
});
