import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../../llm';
import { Agent, EventLog } from '..';
import { isActionEvent } from '../../types';
import type { ToolDefinition } from '../../types/tools';
import type { OpenHandsSettings } from '../../types/settings';

class MockLLM implements LLMClient {
  lastRequest: ChatCompletionRequest | null = null;
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  async *streamChat(_request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.lastRequest = _request;
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

const createWorkspaceRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-security-risk-'));

describe('Agent security risk handling', () => {
  it('includes security_risk in tool schema + prompt for risky confirmations', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { ok: true }> = {
      name: 'noop',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ ok: true }),
      description: 'No-op tool.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
      },
    };

    const llm = new MockLLM([{ type: 'text', text: 'ok' }, { type: 'finish' }]);
    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'risky', riskyThreshold: 'HIGH', confirmUnknown: false } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('hello');

    const request = llm.lastRequest;
    expect(request).not.toBeNull();
    expect(request?.systemPrompt).toContain('<SECURITY_RISK_ASSESSMENT>');

    const parameters = request?.tools?.[0]?.function?.parameters as any;
    expect(parameters?.properties?.security_risk).toBeTruthy();
    expect(parameters?.required).toContain('security_risk');
  });

  it('omits security_risk schema + prompt section when confirmations are disabled', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { ok: true }> = {
      name: 'noop',
      validate: (input) => input as Record<string, unknown>,
      execute: async () => ({ ok: true }),
      description: 'No-op tool.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
        required: ['value'],
      },
    };

    const llm = new MockLLM([{ type: 'text', text: 'ok' }, { type: 'finish' }]);
    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'never' } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('hello');

    const request = llm.lastRequest;
    expect(request).not.toBeNull();
    expect(request?.systemPrompt).not.toContain('<SECURITY_RISK_ASSESSMENT>');

    const parameters = request?.tools?.[0]?.function?.parameters as any;
    expect(parameters?.properties?.security_risk).toBeFalsy();
    expect(parameters?.required ?? []).not.toContain('security_risk');
  });

  it('treats unknown tool-provided security_risk as undefined', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<Record<string, unknown>, { echoed: boolean }> = {
      name: 'echo',
      validate: (input) => input,
      execute: async (args) => ({ echoed: Boolean(args.value) }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Calling tool' },
      {
        type: 'tool_call_delta',
        id: 'call_unknown_risk',
        name: 'echo',
        arguments: '{"security_risk":"CRITICAL","value":true}',
      },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'risky', confirmUnknown: true } },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('unknown risk');

    const events = log.list();
    const action = events.find(isActionEvent);
    expect(action?.security_risk).toBeUndefined();
    expect(agent.state.snapshot.status).toBe('WAITING_FOR_CONFIRMATION');
    expect(agent.pendingActionId).toBeDefined();
  });
});
