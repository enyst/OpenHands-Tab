import { describe, expect, it } from 'vitest';
import { Agent, EventLog } from '../runtime';
import type { ChatCompletionRequest, LLMClient, LLMStreamChunk } from '../llm';
import { isAgentErrorEvent, isMessageEvent, isObservationEvent, isPauseEvent } from '../types';
import type { ToolDefinition } from '../types/tools';
import type { OpenHandsSettings } from '../types/settings';
import { createConfirmationPolicyFromSettings, LLMSecurityAnalyzer, type SecurityAnalyzer } from '../security';

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

describe('Security analyzer + confirmation policy parity', () => {
  it('requires security_risk when enableSecurityAnalyzer is true', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, agent: { enableSecurityAnalyzer: true } },
      events: log,
      workspaceRoot: process.cwd(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run tool');

    const events = log.list();
    expect(events.some(isObservationEvent)).toBe(false);
    expect(events.some(isPauseEvent)).toBe(false);
    expect(events.some(isAgentErrorEvent)).toBe(true);

    const toolMessages = events.filter(isMessageEvent).filter((evt) => evt.llm_message.role === 'tool');
    expect(toolMessages.length).toBe(1);
  });

  it('uses security_risk for ConfirmRisky decisions when analyzer is enabled', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      {
        type: 'tool_call_delta',
        id: 'call_1',
        name: 'echo',
        arguments: '{"security_risk":"LOW","value":"hi"}',
      },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: {
        ...baseSettings,
        agent: { enableSecurityAnalyzer: true },
        confirmation: { policy: 'risky', riskyThreshold: 'MEDIUM', confirmUnknown: true },
      },
      events: log,
      workspaceRoot: process.cwd(),
      llmClient: llm,
      tools: [tool],
    });

    await agent.run('run tool');

    const events = log.list();
    expect(events.some(isPauseEvent)).toBe(false);
    expect(events.some(isObservationEvent)).toBe(true);
  });

  it('creates ConfirmRisky from settings with correct defaults', () => {
    const policy = createConfirmationPolicyFromSettings({
      policy: 'risky',
      riskyThreshold: 'HIGH',
      confirmUnknown: false,
    });

    expect(policy.kind).toBe('ConfirmRisky');
    expect(policy.shouldConfirm('UNKNOWN')).toBe(false);
    expect(policy.shouldConfirm('HIGH')).toBe(true);
    expect(policy.shouldConfirm('MEDIUM')).toBe(false);
  });

  it('preserves runtime confirmation policy overrides across setSettings()', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, confirmation: { policy: 'always' } },
      events: log,
      workspaceRoot: process.cwd(),
      llmClient: llm,
      tools: [tool],
    });

    agent.setConfirmationPolicy(createConfirmationPolicyFromSettings({ policy: 'never' }));
    agent.setSettings({ ...baseSettings, confirmation: { policy: 'always' } });

    await agent.run('run tool');

    const events = log.list();
    expect(events.some(isPauseEvent)).toBe(false);
    expect(events.some(isObservationEvent)).toBe(true);
  });

  it('preserves runtime security analyzer overrides across setSettings()', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"value":"hi"}' },
      { type: 'finish' },
    ]);

    const agent = new Agent({
      settings: { ...baseSettings, agent: { enableSecurityAnalyzer: false } },
      events: log,
      workspaceRoot: process.cwd(),
      llmClient: llm,
      tools: [tool],
    });

    agent.setSecurityAnalyzer(new LLMSecurityAnalyzer());
    agent.setSettings({ ...baseSettings, agent: { enableSecurityAnalyzer: false } });

    await agent.run('run tool');

    const events = log.list();
    expect(events.some(isObservationEvent)).toBe(false);
    expect(events.some(isAgentErrorEvent)).toBe(true);
  });

  it('defaults analyzer errors to HIGH risk (confirmation required)', async () => {
    const log = new EventLog();
    const tool: ToolDefinition<{ value: string }, { echoed: string }> = {
      name: 'echo',
      validate: (input) => ({ value: (input as { value: string }).value }),
      execute: async (args) => ({ echoed: args.value }),
    };

    const llm = new MockLLM([
      { type: 'text', text: 'Using tool' },
      { type: 'tool_call_delta', id: 'call_1', name: 'echo', arguments: '{"security_risk":"LOW","value":"hi"}' },
      { type: 'finish' },
    ]);

    const throwingAnalyzer: SecurityAnalyzer = {
      kind: 'ThrowingAnalyzer',
      securityRisk: () => {
        throw new Error('boom');
      },
      analyzeEvent: () => null,
      analyzePendingActions: () => [],
    };

    const agent = new Agent({
      settings: {
        ...baseSettings,
        confirmation: { policy: 'risky', riskyThreshold: 'HIGH', confirmUnknown: false },
      },
      events: log,
      workspaceRoot: process.cwd(),
      llmClient: llm,
      tools: [tool],
      securityAnalyzer: throwingAnalyzer,
    });

    await agent.run('run tool');

    const events = log.list();
    expect(events.some(isPauseEvent)).toBe(true);
    expect(events.some(isObservationEvent)).toBe(false);
  });
});
