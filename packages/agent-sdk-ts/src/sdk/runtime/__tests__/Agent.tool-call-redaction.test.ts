import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isConversationStateUpdateEvent } from '../../types';
import type { OpenHandsSettings } from '../../types/settings';
import type { ToolDefinition } from '../../types/tools';

class MockLLM implements LLMClient {
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    void _request;
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

const baseSettings: OpenHandsSettings = {
  llm: { model: 'test-model' },
  agent: {},
  conversation: { maxIterations: 1 },
  confirmation: {},
  secrets: {},
};

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tool-redaction-'));

describe('Agent tool call logging redaction', () => {
  it('redacts nested sensitive values when logging tool calls', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };

    const nestedArgs = {
      config: {
        apiKey: 'secret-api-key',
        nested: { token: 'super-secret', keep: 'public' },
      },
      servers: [
        { url: 'https://example.com', password: 'p@ssw0rd' },
        { url: 'https://other.com', headers: { authorization: 'Bearer token' } },
      ],
      safe: 'value',
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool with secrets' },
      { type: 'tool_call_delta', id: 'call_sensitive', name: 'echo', arguments: JSON.stringify(nestedArgs) },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: baseSettings,
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('mask secrets');

    const toolCallEvent = log
      .list()
      .filter(isConversationStateUpdateEvent)
      .find((event) => event.key === 'llm_tool_call_raw');

    expect(toolCallEvent).toBeDefined();
    const rawArgs = (toolCallEvent!.value as { arguments?: string }).arguments;
    expect(typeof rawArgs).toBe('string');

    const loggedArgs = JSON.parse(rawArgs as string);
    expect(loggedArgs.config.apiKey).toBe('[REDACTED]');
    expect(loggedArgs.config.nested.token).toBe('[REDACTED]');
    expect(loggedArgs.config.nested.keep).toBe('public');
    expect(loggedArgs.servers[0].password).toBe('[REDACTED]');
    expect(loggedArgs.servers[1].headers.authorization).toBe('[REDACTED]');
    expect(loggedArgs.safe).toBe('value');
  });
});
