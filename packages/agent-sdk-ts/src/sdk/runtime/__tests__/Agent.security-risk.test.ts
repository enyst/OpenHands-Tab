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

  async *streamChat(request: ChatCompletionRequest): AsyncGenerator<LLMStreamChunk> {
    this.lastRequest = request;
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

const createNoopTool = (): ToolDefinition<Record<string, unknown>, { ok: true }> => ({
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
});

type ConfirmationExpectation = {
  label: string;
  confirmation: OpenHandsSettings['confirmation'];
  shouldIncludeSecurityRisk: boolean;
};

describe('Agent security risk handling', () => {
  it.each<ConfirmationExpectation>([
    {
      label: 'risky confirmations',
      confirmation: { policy: 'risky', riskyThreshold: 'HIGH', confirmUnknown: false },
      shouldIncludeSecurityRisk: true,
    },
    {
      label: 'always confirmations',
      confirmation: { policy: 'always' },
      shouldIncludeSecurityRisk: true,
    },
    {
      label: 'confirmations disabled',
      confirmation: { policy: 'never' },
      shouldIncludeSecurityRisk: false,
    },
  ])('prompt and tool schema includes security_risk when $label', async ({ confirmation, shouldIncludeSecurityRisk }) => {
    const log = new EventLog();
    const llm = new MockLLM([{ type: 'text', text: 'ok' }, { type: 'finish' }]);
    const agent = new Agent({
      settings: { ...baseSettings, confirmation },
      events: log,
      workspaceRoot: createWorkspaceRoot(),
      llmClient: llm,
      tools: [createNoopTool()],
    });

    await agent.run('hello');

    const request = llm.lastRequest;
    expect(request).not.toBeNull();
    if (shouldIncludeSecurityRisk) {
      expect(request?.systemPrompt).toContain('<SECURITY_RISK_ASSESSMENT>');
    } else {
      expect(request?.systemPrompt).not.toContain('<SECURITY_RISK_ASSESSMENT>');
    }

    const parameters = request?.tools?.[0]?.function?.parameters as any;
    if (shouldIncludeSecurityRisk) {
      expect(parameters?.properties?.security_risk).toBeTruthy();
      expect(parameters?.required).toContain('security_risk');
    } else {
      expect(parameters?.properties?.security_risk).toBeFalsy();
      expect(parameters?.required ?? []).not.toContain('security_risk');
    }
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
